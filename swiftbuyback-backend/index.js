// index.js - Full Backend Code

// --- Required Modules ---
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

// --- Firebase Admin SDK Initialization ---
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// --- Middleware ---
app.use(express.json());

const allowedOrigins = [
    'https://toratyosef.github.io',
    'https://cautious-pancake-69p475gq54q4f5qp4-3000.app.github.dev',
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

// Middleware to protect routes with JWT authentication
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Forbidden: Invalid token' });
        }
        req.user = user;
        next();
    });
};

// --- API Endpoint for User Login ---
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();

        if (snapshot.empty) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const userData = snapshot.docs[0].data();
        const userId = snapshot.docs[0].id;

        const isPasswordValid = await bcrypt.compare(password, userData.passwordHash);

        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign({ userId: userId, email: userData.email }, JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ message: 'Login successful', token: token });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'An error occurred during login.' });
    }
});


// --- USPS API Helper Functions ---

async function getUspsAccessToken() {
    const clientId = process.env.USPS_CONSUMER_KEY;
    const clientSecret = process.env.USPS_CONSUMER_SECRET;
    
    const authUrl = 'https://apis-tem.usps.com/oauth2/v3/token';

    const payload = {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials"
    };

    try {
        const response = await axios.post(authUrl, payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        return response.data.access_token;
    } catch (error) {
        console.error("Failed to get USPS access token:", error.response?.data || error.message);
        throw new Error("Failed to authenticate with USPS.");
    }
}

async function getPaymentToken(accessToken) {
    const CRID = process.env.USPS_CRID;
    const MID = process.env.USPS_MID;
    const accountNumber = process.env.USPS_ACCOUNT_NUMBER;
    
    const paymentUrl = 'https://apis-tem.usps.com/payments/v3/payment-authorization';

    const payload = {
        roles: [{
            roleName: "PAYER",
            CRID: CRID,
            MID: MID,
            accountType: "EPS",
            accountNumber: accountNumber
        },
        {
            roleName: "LABEL_OWNER",
            CRID: CRID,
            MID: MID,
            accountType: "EPS",
            accountNumber: accountNumber
        }]
    };

    try {
        const response = await axios.post(paymentUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            }
        });
        return response.data.paymentAuthorizationToken;
    } catch (error) {
        console.error("Failed to get USPS payment token:", error.response?.data || error.message);
        throw new Error("Failed to authorize USPS payment.");
    }
}

// --- API Endpoint for Order Submission from the Frontend ---
// This endpoint is now protected with the authenticateToken middleware
app.post('/api/submit-order', authenticateToken, async (req, res) => {
    try {
        const orderData = req.body;

        if (!orderData || Object.keys(orderData).length === 0) {
            return res.status(400).json({ error: 'Request body is empty or invalid.' });
        }

        const newOrderRef = db.collection('orders').doc();
        const dataToSave = {
            ...orderData,
            status: 'pending_shipment',
            userId: req.user.userId, // Save the user ID from the token
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await newOrderRef.set(dataToSave);
        console.log(`New order submitted with ID: ${newOrderRef.id} by user ${req.user.userId}`);

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
app.get('/api/orders', async (req, res) => {
    // This endpoint should also be protected in a real app
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
        const missingFields = ['fullName', 'streetAddress', 'city', 'state', 'zipCode', 'email'].filter(field => !shippingDetails[field]);
        
        if (missingFields.length > 0) {
            console.error(`Missing required shipping fields for order ${orderId}: ${missingFields.join(', ')}`);
            return res.status(400).json({ error: `Missing required shipping fields: ${missingFields.join(', ')}` });
        }

        const accessToken = await getUspsAccessToken();
        const paymentToken = await getPaymentToken(accessToken);

        const uspsApiUrl = 'https://apis-tem.usps.com/labels/v3/label';
        const fromAddress = {
            "firstName": "Your",
            "lastName": "Company",
            "streetAddress": "4120 Bingham Ave",
            "city": "St. Louis",
            "state": "MO",
            "ZIPCode": "63116"
        };
        const toAddress = {
            "firstName": shippingDetails.fullName.split(' ')[0] || '',
            "lastName": shippingDetails.fullName.split(' ').slice(1).join(' ') || '',
            "streetAddress": shippingDetails.streetAddress,
            "secondaryAddress": shippingDetails.streetAddress2 || '',
            "city": shippingDetails.city,
            "state": shippingDetails.state,
            "ZIPCode": shippingDetails.zipCode
        };

        const labelPayload = {
            "imageInfo": {
                "imageType": "PDF",
                "labelType": "4X6LABEL",
                "receiptOption": "NONE",
                "suppressPostage": false,
                "suppressMailDate": false,
                "returnLabel": false
            },
            "toAddress": toAddress,
            "fromAddress": fromAddress,
            "packageDescription": {
                "mailClass": "PRIORITY_MAIL_EXPRESS",
                "rateIndicator": "SP",
                "weightUOM": "lb",
                "weight": 0.5,
                "dimensionsUOM": "in",
                "length": 9,
                "width": 6,
                "height": 2,
                "processingCategory": "MACHINABLE",
                "mailingDate": new Date().toISOString().split('T')[0],
                "extraServices": [920],
                "packageOptions": {
                    "packageValue": orderData.estimatedQuote || 0
                }
            }
        };

        let labelPdfBuffer;
        let trackingNumber = '';

        try {
            const uspsResponse = await axios.post(uspsApiUrl, labelPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                    'X-Payment-Authorization-Token': paymentToken
                },
                responseType: 'arraybuffer'
            });

            const contentType = uspsResponse.headers['content-type'];
            if (contentType.includes('application/pdf')) {
                labelPdfBuffer = uspsResponse.data;
            } else {
                 // For multipart responses, you'll need to parse the JSON part to get the metadata
                 // This is complex and left as a placeholder for a real implementation
            }
            
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=usps-label-${orderId}.pdf`);
            res.send(labelPdfBuffer);
            
            await orderDocRef.update({
                status: 'label_generated',
                uspsLabelUrl: 'https://placeholder.com/your-real-pdf-url',
                uspsTrackingNumber: trackingNumber || 'N/A',
                labelGeneratedAt: admin.firestore.FieldValue.serverTimestamp()
            });

        } catch (uspsError) {
            console.error("USPS API call failed:", uspsError.response?.data?.error || uspsError.message);
            return res.status(502).json({ error: 'Failed to get a valid response from USPS API.' });
        }
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

// Serve static files and the main HTML pages
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/sell', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sell.html'));
});
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});


// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Admin backend server running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}`);
});