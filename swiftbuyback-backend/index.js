// index.js (or app.js)

// --- Required Modules ---
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors'); // For Cross-Origin Resource Sharing
const axios = require('axios'); // For making HTTP requests to external APIs like USPS

// --- Firebase Admin SDK Initialization ---
// Get Firebase service account config from environment variable
const firebaseServiceAccountConfig = process.env.FIREBASE_SERVICE_ACCOUNT_CONFIG;

if (!firebaseServiceAccountConfig) {
    console.error("FIREBASE_SERVICE_ACCOUNT_CONFIG environment variable is not set.");
    // Exit or handle error gracefully if Firebase credentials are essential for startup
    process.exit(1);
}

try {
    // NEW: Directly parse the environment variable content
    const serviceAccount = JSON.parse(firebaseServiceAccountConfig);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // databaseURL: "https://your-project-id.firebaseio.com" // Optional, can often be inferred
    });
} catch (e) {
    console.error("Error parsing FIREBASE_SERVICE_ACCOUNT_CONFIG:", e);
    process.exit(1);
}

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000; // Use port 3000 or an environment variable

// --- Middleware ---
app.use(cors({
    origin: '*', // Allow all origins for development. FOR PRODUCTION, CHANGE THIS to your admin frontend URL!
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json()); // To parse JSON request bodies

// --- NEW: Root Path Handler ---
app.get('/', (req, res) => {
    res.status(200).send('SwiftBuyBack Admin Backend is running!');
});


// --- API Endpoints ---

// Endpoint to get all pending orders
app.get('/api/orders', async (req, res) => {
    try {
        const appId = process.env.APP_ID || 'default-app-id'; // Get appId from environment variable for backend
        const ordersCollectionRef = db.collection(`artifacts/${appId}/public/data/orders`); // Example path for public orders

        const snapshot = await ordersCollectionRef.where('status', '==', 'pending_shipment').get();
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

// Endpoint to generate USPS label and update order status
app.post('/api/generate-label/:orderId', async (req, res) => {
    const orderId = req.params.orderId;

    try {
        const appId = process.env.APP_ID || 'default-app-id';
        const orderDocRef = db.collection(`artifacts/${appId}/public/data/orders`).doc(orderId);
        const orderDoc = await orderDocRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const orderData = orderDoc.data();
        const shippingDetails = orderData.shippingDetails;

        // --- USPS API Integration Logic ---
        // Get your API credentials from environment variables
        const uspsConsumerKey = process.env.USPS_CONSUMER_KEY;
        const uspsConsumerSecret = process.env.USPS_CONSUMER_SECRET;
        const uspsApiUrl = 'https://api.usps.com/production/shipping/v1/labels'; // Example: NEW USPS Label API endpoint

        if (!uspsConsumerKey || !uspsConsumerSecret) {
            console.error("USPS API credentials not set in environment variables.");
            return res.status(500).json({ error: 'USPS API credentials missing.' });
        }

        // --- Construct Request Payload for NEW USPS API (EXAMPLE JSON FORMAT) ---
        // This is a hypothetical structure based on common RESTful APIs.
        // You MUST consult the actual USPS APIs Developer Portal documentation
        // for the precise JSON payload structure, required fields, and authentication.
        const requestPayload = {
            fromAddress: {
                fullName: "SwiftBuyBack Corp.", // Your company name
                address1: "123 Main St", // Your company address
                city: "New York",
                state: "NY",
                zipCode: "10001",
                country: "US"
            },
            toAddress: {
                fullName: shippingDetails.fullName,
                address1: shippingDetails.address,
                city: shippingDetails.city,
                state: shippingDetails.state,
                zipCode: shippingDetails.zip,
                country: shippingDetails.country || "US" // Use provided country or default to US
            },
            packageDetails: {
                weightInPounds: 1, // You might need to add this to your frontend form
                length: 10,
                width: 8,
                height: 4,
                packagingType: "BOX", // Or other USPS packaging types
            },
            serviceType: "PRIORITY_MAIL", // Or "FIRST_CLASS_MAIL", etc.
            imageType: "PDF",
            // You might need an Authorization header like 'Bearer' token or custom header based on their new API
        };

        let uspsLabelUrl = ''; // Initialize to empty string
        let boxSent = false; // Initialize to false

        try {
            // Make the actual USPS API call using axios
            const uspsApiResponse = await axios.post(uspsApiUrl, requestPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${uspsConsumerKey}:${uspsConsumerSecret}` // Example: For basic auth or a derived token
                    // You might need a different header based on the new USPS API authentication method (e.g., 'API-Key', 'X-USPS-Key')
                    // Often, the Consumer Key and Secret are used to obtain an access token first.
                },
                // Add a timeout to the request to prevent hanging
                timeout: 10000 // 10 seconds
            });

            // --- Parse USPS response and extract label URL/data ---
            // This part is highly dependent on the *actual* USPS API response structure.
            // Assuming the API returns a direct URL or Base64 data for the label
            const labelData = uspsApiResponse.data;

            if (labelData && labelData.labelPdfUrl) { // Example: If USPS returns a direct URL
                uspsLabelUrl = labelData.labelPdfUrl;
                boxSent = true; // Assume a label implies a shipping kit
            } else if (labelData && labelData.labelBase64) { // Example: If USPS returns Base64 data
                // You might save this Base64 data to Google Cloud Storage
                // and then get a public URL for it. For now, we'll simulate.
                uspsLabelUrl = `data:application/pdf;base64,${labelData.labelBase64}`; // For direct display in browser (small labels)
                boxSent = true;
            } else {
                console.warn("USPS API response did not contain expected label URL or Base64 data.");
                uspsLabelUrl = `https://example.com/usps-label-simulated-${orderId}.pdf`; // Fallback placeholder
                boxSent = true; // Still simulate for testing
            }

        } catch (uspsError) {
            console.error(`Error during USPS API call for order ${orderId}:`, uspsError.response ? uspsError.response.data : uspsError.message);
            // If USPS API fails, you might still want to proceed with a simulated label or mark an error state
            uspsLabelUrl = `https://example.com/usps-api-failed-simulated-${orderId}.pdf`; // Fallback placeholder
            boxSent = false; // Indicate box not sent due to API failure
            // Re-throw or handle more gracefully based on your business logic
            throw new Error(`USPS API failed: ${uspsError.response ? JSON.stringify(uspsError.response.data) : uspsError.message}`);
        }
        // --- End USPS API Integration Logic ---


        // Update Firestore order document
        await orderDocRef.update({
            status: 'label_generated', // Or 'shipping_kit_sent'
            uspsLabelUrl: uspsLabelUrl,
            boxSent: boxSent,
            labelGeneratedAt: admin.firestore.FieldValue.serverTimestamp() // Use server timestamp
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

// Endpoint to update order status (e.g., mark as received, completed)
app.put('/api/orders/:orderId/status', async (req, res) => {
    const orderId = req.params.orderId;
    const { status } = req.body; // New status from admin frontend

    if (!status) {
        return res.status(400).json({ error: 'Status is required' });
    }

    try {
        const appId = process.env.APP_ID || 'default-app-id';
        const orderDocRef = db.collection(`artifacts/${appId}/public/data/orders`).doc(orderId);
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
