import functions from "firebase-functions";
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import axios from "axios";

const app = express();

// CORS for your frontend
app.use(
  cors({
    origin: "https://toratyosef.github.io",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);
app.use(express.json());

// Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const ordersCollection = db.collection("orders");

// Fetch all orders
app.get("/api/orders", async (req, res) => {
  try {
    const snapshot = await ordersCollection.get();
    const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// Submit new order
app.post("/api/submit-order", async (req, res) => {
  try {
    const orderData = req.body;
    if (!orderData?.shippingInfo || !orderData?.estimatedQuote)
      return res.status(400).json({ error: "Invalid order data" });

    const docRef = await ordersCollection.add({
      ...orderData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending_shipment",
    });

    res.status(201).json({ message: "Order submitted", orderId: docRef.id });
  } catch (error) {
    console.error("Error submitting order:", error);
    res.status(500).json({ error: "Failed to submit order" });
  }
});

// Helper: Create ShipStation label
async function createShipStationLabel(order) {
  const apiKey = functions.config().shipstation.key;
  const isSandbox = functions.config().shipstation.sandbox === "true";

  const payload = {
    shipment: {
      service_code: "usps_priority_mail",
      ship_to: order.shippingInfo,
      ship_from: {
        name: "QuickBuck Buyback",
        company_name: "QuickBuck",
        phone: "0000000000",
        address_line1: "123 Example St",
        city_locality: "Brooklyn",
        state_province: "NY",
        postal_code: "11230",
        country_code: "US",
      },
      packages: [{ weight: { value: 1, unit: "ounce" } }],
    },
  };

  if (isSandbox) payload.testLabel = true;

  const response = await axios.post("https://api.shipengine.com/v1/labels", payload, {
    headers: { "API-Key": apiKey, "Content-Type": "application/json" },
  });

  return response.data;
}

// Generate USPS Label
app.post("/api/generate-label/:id", async (req, res) => {
  try {
    const doc = await ordersCollection.doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });

    const order = { id: doc.id, ...doc.data() };
    const labelData = await createShipStationLabel(order);

    await ordersCollection.doc(req.params.id).update({
      status: "label_generated",
      uspsLabelUrl: labelData.label_download?.pdf,
    });

    res.json({ message: "Label generated", uspsLabelUrl: labelData.label_download?.pdf });
  } catch (error) {
    console.error("Error generating label:", error.response?.data || error);
    res.status(500).json({ error: "Failed to generate label" });
  }
});

// Update order status
app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required" });

    await ordersCollection.doc(req.params.id).update({ status });
    res.json({ message: `Order marked as ${status}` });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ error: "Failed to update status" });
  }
});

// ✅ Export as Firebase Function
export const api = functions.https.onRequest(app);
