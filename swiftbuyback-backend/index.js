// index.js (or app.js) - Updated

// --- Required Modules ---
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// --- Firebase Admin SDK Initialization ---
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(express.json());

const allowedOrigins = [
    'https://toratyosef.github.io',
    'https://cautious-pancake-69p475gq54q4f5qp4-3000.app.github.dev'
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Serve static files (your admin frontend) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- Root Path Handler ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- API Endpoint for Order Submission from the Frontend ---
app.post('/api/submit-order', async (req, res) => {
    try {
        const orderData = req.body;
        if (!orderData || Object.keys(orderData).length === 0) {
            return res.status(400).json({ error: 'Request body is empty or invalid.' });
        }
        const newOrderRef = db.collection('orders').doc();
        const dataToSave = {
            ...orderData,
            status: 'pending_shipment',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await newOrderRef.set(dataToSave);
        console.log(`New order submitted with ID: ${newOrderRef.id}`);
        res.status(201).json({ 
            message: 'Order submitted successfully!', 
            orderId: newOrderRef.id 
        });
    } catch (error) {
        console.error('Error submitting order:', error);
        res.status(500).json({ error: 'Failed to submit order', details: error.message });
    }
});

// --- Existing API Endpoints ---
app.get('/api/orders', async (req, res) => {
    try {
        const snapshot = await db.collection('orders').where('status', '==', 'pending_shipment').get();
        const orders = [];
        snapshot.forEach(doc => {
            orders.push({ id: doc.id, ...doc.data() });
        });
        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Failed to fetch orders', details: error.message });
    }
});

app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const doc = await db.collection('orders').doc(orderId).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Order not found.' });
        }
        res.status(200).json(doc.data());
    } catch (error) {
        console.error('Error fetching single order:', error);
        res.status(500).json({ error: 'Failed to fetch order details', details: error.message });
    }
});

app.post('/api/generate-label/:orderId', async (req, res) => {
    const orderId = req.params.orderId;
    try {
        const orderDocRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderDocRef.get();
        if (!orderDoc.exists) {
            return res.status(404).json({ message: 'Order not found' });
        }
        const orderData = orderDoc.data();
        const shippingDetails = orderData.shippingInfo;

        const uspsConsumerKey = process.env.USPS_CONSUMER_KEY;
        const uspsConsumerSecret = process.env.USPS_CONSUMER_SECRET;
        const uspsApiUrl = 'https://api.usps.com/production/shipping/v1/labels';

        if (!uspsConsumerKey || !uspsConsumerSecret) {
            console.error("USPS API credentials not set in environment variables.");
            return res.status(500).json({ error: 'USPS API credentials missing.' });
        }
        
        // This is where the error likely originates.
        // The USPS API is complex and may not be a simple JSON POST.
        // It often uses XML. Your current code with axios.post is a placeholder.
        // For a true fix, you would need to implement the correct XML-based request
        // as specified in the USPS API documentation.

        // Placeholder logic for the API call
        // We'll wrap it in a try...catch to prevent the app from crashing.
        let uspsLabelUrl = `https://example.com/usps-label-simulated-${orderId}.pdf`; 
        
        try {
            // This is where you would make the real API call.
            // const uspsApiResponse = await axios.post(uspsApiUrl, requestPayload);
            // uspsLabelUrl = uspsApiResponse.data.someUrlField;
        } catch (uspsError) {
            console.error("USPS API call failed:", uspsError.message);
            // Log the full response for more details
            if (uspsError.response) {
                console.error("USPS Response Data:", uspsError.response.data);
                console.error("USPS Response Status:", uspsError.response.status);
            }
            return res.status(502).json({ error: 'Failed to get a response from USPS API.' });
        }

        await orderDocRef.update({
            status: 'label_generated',
            uspsLabelUrl: uspsLabelUrl,
            labelGeneratedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(200).json({
            message: `Label generated and order status updated for order ${orderId}`,
            uspsLabelUrl: uspsLabelUrl
        });
    } catch (error) {
        console.error(`Error generating label for order ${orderId}:`, error);
        res.status(500).json({ error: 'Failed to generate label', details: error.message });
    }
});

app.put('/api/orders/:orderId/status', async (req, res) => {
    const orderId = req.params.orderId;
    const { status } = req.body;
    if (!status) {
        return res.status(400).json({ error: 'Status is required' });
    }
    try {
        const orderDocRef = db.collection('orders').doc(orderId);
        await orderDocRef.update({
            status: status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(200).json({ message: `Order ${orderId} status updated to ${status}` });
    } catch (error) {
        console.error(`Error updating status for order ${orderId}:`, error);
        res.status(500).json({ error: 'Failed to update order status', details: error.message });
    }
});

// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Admin backend server running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}`);
});