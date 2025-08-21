import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS to allow requests from your GitHub Pages domain.
// This is crucial for enabling communication between your frontend and backend.
app.use(
  cors({
    origin: "https://toratyosef.github.io",
  })
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Firebase Admin Initialization
const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, "serviceAccountKey.json"))
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const ordersCollection = db.collection("orders");

// Serve admin.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Fetch all orders
app.get("/api/orders", async (req, res) => {
  try {
    const snapshot = await ordersCollection.get();
    const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch orders from Firestore" });
  }
});

// Fetch single order
app.get("/api/orders/:id", async (req, res) => {
  try {
    const doc = await ordersCollection.doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch order from Firestore" });
  }
});

// Submit a new order
// This is the new endpoint to handle the front-end form submission.
app.post("/api/submit-order", async (req, res) => {
  try {
    const orderData = req.body;
    // Basic validation of incoming data
    if (!orderData || !orderData.shippingInfo || !orderData.estimatedQuote) {
      return res.status(400).json({ error: "Invalid order data" });
    }
    // Add the new order to the Firestore database
    const docRef = await ordersCollection.add({
      ...orderData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending_shipment",
    });
    console.log(`Order ${docRef.id} successfully added to Firestore.`);
    // Respond to the client with a success message
    res.status(201).json({
      message: "Order submitted successfully",
      orderId: docRef.id,
    });
  } catch (error) {
    console.error("Error submitting order:", error);
    res.status(500).json({ error: "Failed to submit order" });
  }
});

// ShipStation API integration function
async function createShipStationLabel(order) {
  const apiKey = process.env.SS_API_KEY;
  const isSandbox = process.env.SS_SANDBOX === "true";

  const payload = {
    shipment: {
      service_code: "usps_first_class_mail",
      ship_to: {
        name: order.shippingInfo.fullName,
        phone: order.shippingInfo.phoneNumber,
        address_line1: order.shippingInfo.streetAddress,
        city_locality: order.shippingInfo.city,
        state_province: order.shippingInfo.state,
        postal_code: order.shippingInfo.zipCode,
        country_code: "US",
        address_residential_indicator: "yes",
      },
      ship_from: {
        name: "Your Company Name",
        company_name: "Your Company",
        phone: "+1 555-555-5555",
        address_line1: "123 Main St",
        city_locality: "Austin",
        state_province: "TX",
        postal_code: "78701",
        country_code: "US",
        address_residential_indicator: "no",
      },
      packages: [
        {
          weight: {
            value: 1, // Assumes 1 ounce for simplicity; adjust as needed
            unit: "ounce",
          },
          dimensions: {
            height: 1,
            width: 8,
            length: 10,
            unit: "inch",
          },
        },
      ],
    },
  };

  if (isSandbox) {
    payload.testLabel = true;
  }

  const response = await axios.post(
    "https://api.shipengine.com/v1/labels",
    payload,
    {
      headers: {
        "API-Key": apiKey,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data;
}

// Generate shipping label
app.post("/api/generate-label/:id", async (req, res) => {
  try {
    const orderRef = ordersCollection.doc(req.params.id);
    const doc = await orderRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });

    const order = { id: doc.id, ...doc.data() };
    const labelData = await createShipStationLabel(order);

    await orderRef.update({
      status: "label_generated",
      uspsLabelUrl: labelData.label_download?.pdf,
    });

    res.json({
      message: "Label generated successfully",
      uspsLabelUrl: labelData.label_download?.pdf,
    });
  } catch (error) {
    console.error(error.response?.data || error);
    res.status(500).json({ error: "Failed to generate label" });
  }
});

// Update order status
app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required" });

    const orderRef = ordersCollection.doc(req.params.id);
    const doc = await orderRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });

    await orderRef.update({ status });
    res.json({ message: `Order marked as ${status}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});