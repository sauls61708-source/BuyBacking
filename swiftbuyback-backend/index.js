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
    'http://localhost:3000'
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error('CORS Error: Not allowed by CORS. Origin:', origin);
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

// --- API Endpoints ---

// Endpoint to get all pending orders
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

// Endpoint to get a single order by ID
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

// Endpoint to generate USPS label and update order status
app.post('/api/generate-label/:orderId', async (req, res) => {
    const orderId = req.params.orderId;
    try {
        const orderDocRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderDocRef.get();
        if (!orderDoc.exists) {
            return res.status(404).json({ message: 'Order not found' });
        }
        const orderData = orderDoc.data();
        
        // ADDED: Check if shippingInfo exists and has required fields
        if (!orderData || !orderData.shippingInfo || !orderData.shippingInfo.fullName) {
            console.error('Missing or incomplete shipping info for order:', orderId);
            return res.status(400).json({ error: 'Order data is missing shipping information.' });
        }
        const shippingDetails = orderData.shippingInfo;
        
        const requiredShippingFields = ['fullName', 'streetAddress', 'city', 'state', 'zipCode', 'email'];
        const missingFields = requiredShippingFields.filter(field => !shippingDetails[field]);
        
        if (missingFields.length > 0) {
            console.error(`Missing required shipping fields for order ${orderId}: ${missingFields.join(', ')}`);
            return res.status(400).json({ error: `Missing required shipping fields: ${missingFields.join(', ')}` });
        }

        const uspsConsumerKey = process.env.USPS_CONSUMER_KEY;
        const uspsConsumerSecret = process.env.USPS_CONSUMER_SECRET;
        const uspsApiUrl = 'https://api.usps.com/production/shipping/v1/labels';

        if (!uspsConsumerKey || !uspsConsumerSecret) {
            console.error("USPS API credentials not set in environment variables.");
            return res.status(500).json({ error: 'USPS API credentials missing. Please set USPS_CONSUMER_KEY and USPS_CONSUMER_SECRET.' });
        }
        
        let uspsLabelUrl = `https://example.com/usps-label-simulated-${orderId}.pdf`; 
        
        try {
            console.log("Simulating USPS label generation for order:", orderId);
        } catch (uspsError) {
            console.error("USPS API call failed:", uspsError.message);
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

// Endpoint to update order status
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