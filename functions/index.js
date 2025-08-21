// ------------------------------
// FUNCTIONS INDEX.JS (v1 / Node 18)
// ------------------------------

const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");

const app = express();

const allowedOrigins = [
  "https://toratyosef.github.io",
  "https://buyback-a0f05.web.app"
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);
app.use(express.json());

// ✅ Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const ordersCollection = db.collection("orders");

// ------------------------------
// ROUTES
// ------------------------------

// 📌 Fetch all orders
app.get("/api/orders", async (req,res)=>{
  try {
    const snapshot = await ordersCollection.get();
    const orders = snapshot.docs.map(doc=>({id: doc.id, ...doc.data()}));
    res.json(orders);
  } catch(err){
    console.error("Error fetching orders:", err);
    res.status(500).json({error:"Failed to fetch orders"});
  }
});

// 📌 Submit new order
app.post("/api/submit-order", async (req,res)=>{
  try {
    const orderData = req.body;
    if(!orderData?.shippingInfo || !orderData?.estimatedQuote){
      return res.status(400).json({error:"Invalid order data"});
    }

    const docRef = await ordersCollection.add({
      ...orderData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status:"pending_shipment"
    });

    res.status(201).json({message:"Order submitted", orderId: docRef.id});
  } catch(err){
    console.error("Error submitting order:", err);
    res.status(500).json({error:"Failed to submit order"});
  }
});

// ------------------------------
// ShipStation / ShipEngine Helper
// ------------------------------

async function createShipStationLabel(order){
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
        country_code: "US"
      },
      packages: [{ weight: { value: 1, unit: "ounce" } }]
    }
  };

  if(isSandbox) payload.testLabel = true;

  const response = await axios.post(
    "https://api.shipengine.com/v1/labels",
    payload,
    { headers: { "API-Key": apiKey, "Content-Type":"application/json" } }
  );

  return response.data;
}

// 📌 Generate USPS label
app.post("/api/generate-label/:id", async (req,res)=>{
  try {
    const doc = await ordersCollection.doc(req.params.id).get();
    if(!doc.exists) return res.status(404).json({error:"Order not found"});

    const order = {id: doc.id, ...doc.data()};
    const labelData = await createShipStationLabel(order);

    await ordersCollection.doc(req.params.id).update({
      status:"label_generated",
      uspsLabelUrl: labelData.label_download?.pdf
    });

    res.json({
      message:"Label generated",
      uspsLabelUrl: labelData.label_download?.pdf
    });
  } catch(err){
    console.error("Error generating label:", err.response?.data || err);
    res.status(500).json({error:"Failed to generate label"});
  }
});

// 📌 Update order status
app.put("/api/orders/:id/status", async (req,res)=>{
  try {
    const {status} = req.body;
    if(!status) return res.status(400).json({error:"Status is required"});

    await ordersCollection.doc(req.params.id).update({status});
    res.json({message:`Order marked as ${status}`});
  } catch(err){
    console.error("Error updating status:", err);
    res.status(500).json({error:"Failed to update status"});
  }
});

// ------------------------------
// EXPORT AS V1 FUNCTION
// ------------------------------
exports.api = functions.https.onRequest(app);
