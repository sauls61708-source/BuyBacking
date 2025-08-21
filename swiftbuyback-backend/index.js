// index.js (or app.js)

// --- Required Modules ---
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors'); // For Cross-Origin Resource Sharing

// --- Firebase Admin SDK Initialization ---
// Make sure your serviceAccountKey.json is in the same directory as this file
// Or, provide the path to it. For Codespaces, you might upload it or
// use environment variables for sensitive parts of the config.
const serviceAccount = require('./serviceAccountKey.json'); // Securely store this!

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Replace with your Firestore project ID if not automatically detected
  // databaseURL: "https://your-project-id.firebaseio.com"
});

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

// --- API Endpoints ---

// Endpoint to get all pending orders
app.get('/api/orders', async (req, res) => {
    try {
        // You can filter orders based on 'status' if needed, e.g., 'pending_shipment'
        // const ordersRef = db.collection(`artifacts/${__app_id}/users/${userId}/orders`); // This path would be complex to get all users' orders
        // For an admin panel, you'd likely query a 'public' collection or iterate
        // through users. Let's simplify for demonstration by assuming a master 'orders' collection.
        // If your orders are structured as artifacts/{appId}/users/{userId}/orders,
        // you will need more complex logic to fetch across all users.
        // A common pattern for admin access is to have a top-level 'orders' collection
        // where all orders are duplicated/aggregated for easier admin access.

        // For simplicity, let's assume a 'public' orders collection for admin view
        // IMPORTANT: Ensure your Firestore Security Rules allow read access to this collection for your Admin SDK!
        const appId = process.env.APP_ID || 'default-app-id'; // Get appId from environment variable for backend
        const ordersCollectionRef = db.collection(`artifacts/${appId}/public/data/orders`); // Example path for public orders

        // Or if orders are strictly per-user, fetching all requires listing users (complex)
        // or a different data model for admin view.
        // For now, let's assume a simplified direct top-level collection for admin view.

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
    // In a real application, you would pass package dimensions, weight, etc., in req.body
    // For simplicity, this example just updates status.

    try {
        const appId = process.env.APP_ID || 'default-app-id';
        // You'll need to fetch the specific order document.
        // If orders are stored under users/{userId}/orders, you need the userId.
        // For admin purposes, you might have a master 'orders' collection, or
        // fetch the userId from the order itself if it was stored there.
        // Example: Assume a simplified master collection for admin.
        const orderDocRef = db.collection(`artifacts/${appId}/public/data/orders`).doc(orderId);
        const orderDoc = await orderDocRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const orderData = orderDoc.data();
        const shippingDetails = orderData.shippingDetails;

        // --- USPS API Integration Logic ---
        // THIS IS PSEUDO-CODE AND REQUIRES A REAL USPS API IMPLEMENTATION
        // You would use an HTTP client (like 'axios' or built-in 'https') to call USPS.
        // Example:
        // const uspsUserId = process.env.USPS_API_USER_ID; // From environment variables
        // const uspsApiUrl = 'https://secure.shippingapis.com/ShippingAPI.dll'; // Example URL

        // // Construct XML/JSON request payload for USPS Shipping Label API
        // const requestPayload = `
        //     <ImageLabelRequest>
        //         <USERID>${uspsUserId}</USERID>
        //         <TrackId></TrackId> <!-- If you have one, or USPS will provide -->
        //         <FromName>${YOUR_COMPANY_NAME}</FromName>
        //         <FromFirm>${YOUR_COMPANY_NAME}</FromFirm>
        //         <FromAddress1>${YOUR_COMPANY_ADDRESS_LINE1}</FromAddress1>
        //         <FromAddress2>${YOUR_COMPANY_ADDRESS_LINE2}</FromAddress2>
        //         <FromCity>${YOUR_COMPANY_CITY}</FromCity>
        //         <FromState>${YOUR_COMPANY_STATE}</FromState>
        //         <FromZip5>${YOUR_COMPANY_ZIP}</FromZip5>
        //         <ToName>${shippingDetails.fullName}</ToName>
        //         <ToAddress1>${shippingDetails.address}</ToAddress1>
        //         <ToCity>${shippingDetails.city}</ToCity>
        //         <ToState>${shippingDetails.state}</ToState>
        //         <ToZip5>${shippingDetails.zip}</ToZip5>
        //         <Pounds>1</Pounds> <!-- Example weight, you'd make this dynamic -->
        //         <Ounces>0</Ounces>
        //         <ServiceType>Priority</ServiceType>
        //         <ImageType>PDF</ImageType>
        //         <!-- ... other required fields for your chosen USPS service -->
        //     </ImageLabelRequest>
        // `;

        // // Make the actual USPS API call (using a library like axios)
        // const uspsApiResponse = await axios.post(uspsApiUrl, requestPayload, {
        //     headers: { 'Content-Type': 'application/xml' } // Or 'application/json'
        // });

        // // Parse USPS response and extract label URL/data
        // const labelData = uspsApiResponse.data; // This would be the Base64 label data or a URL
        // const uspsLabelUrl = "URL_TO_GENERATED_LABEL_OR_BASE64_DATA"; // Replace with actual value

        // --- End USPS API Integration Logic ---

        // Simulate label generation
        const uspsLabelUrl = `https://example.com/usps-label-${orderId}.pdf`; // Placeholder URL
        const boxSent = true; // Simulate box request

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
