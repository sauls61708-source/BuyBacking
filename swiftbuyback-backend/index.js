import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from /public
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

app.use(cors());
app.use(express.json());

// Firebase Admin Initialization
const serviceAccount = JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const ordersCollection = db.collection('orders');

// Serve admin.html on root
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Get all orders
app.get("/api/orders", async (req, res) => {
    try {
        const snapshot = await ordersCollection.get();
        const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(orders);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Generate label using ShipEngine sandbox
app.post("/api/generate-label/:id", async (req, res) => {
    try {
        const orderRef = ordersCollection.doc(req.params.id);
        const doc = await orderRef.get();
        if (!doc.exists) return res.status(404).json({ error: "Order not found" });

        // ShipEngine Sandbox request
        const response = await fetch("https://api.shipengine.com/v1/labels", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "API-Key": process.env.SS_API_KEY
            },
            body: JSON.stringify({
                shipment: {
                    service_code: "usps_first_class",
                    ship_to: {
                        name: "Customer",
                        address_line1: "123 Main St",
                        city: "Columbus",
                        state: "OH",
                        postal_code: "43215",
                        country_code: "US"
                    },
                    packages: [{ weight: { value: 1, unit: "ounce" } }]
                }
            })
        });

        const data = await response.json();
        await orderRef.update({ status: 'label_generated', uspsLabelUrl: data.label_download.link });

        res.json({ message: "Label generated", uspsLabelUrl: data.label_download.link });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Update order status
app.put("/api/orders/:id/status", async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) return res.status(400).json({ error: "Status required" });

        const orderRef = ordersCollection.doc(req.params.id);
        const doc = await orderRef.get();
        if (!doc.exists) return res.status(404).json({ error: "Order not found" });

        await orderRef.update({ status });
        res.json({ message: `Order marked as ${status}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Start server
app.listen(PORT, () => console.log(`🚀 Backend running at http://localhost:${PORT}`));
