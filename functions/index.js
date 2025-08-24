const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const nodemailer = require("nodemailer");

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();
const ordersCollection = db.collection("orders");

const app = express();

// Configure CORS for all routes.
// The Cloud Function itself is exposed under '/api', so the routes defined here
// should not include '/api' in their path.
const allowedOrigins = [
    "https://toratyosef.github.io",
    "https://buyback-a0f05.web.app"
];

app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"], // Explicitly allow Content-Type header
}));
app.use(express.json()); // Middleware to parse JSON request bodies

// Set up Nodemailer transporter using the Firebase Functions config
// IMPORTANT: Ensure you have configured these environment variables:
// firebase functions:config:set email.user="your_email@gmail.com" email.pass="your_app_password"
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: functions.config().email.user,
        pass: functions.config().email.pass
    }
});

/**
 * Generates a unique five-digit order number in the XX-XXX format.
 * It retries if the generated number already exists in the database to ensure uniqueness.
 * @returns {Promise<string>} A unique order number string (e.g., "12-345").
 */
async function generateUniqueFiveDigitOrderNumber() {
    let unique = false;
    let orderNumber;
    while (!unique) {
        // Generate a random 5-digit number between 10000 and 99999
        const num = Math.floor(10000 + Math.random() * 90000);
        // Format it as XX-XXX
        const firstPart = String(num).substring(0, 2);
        const secondPart = String(num).substring(2, 5);
        orderNumber = `${firstPart}-${secondPart}`;

        // Check if an order with this custom ID already exists
        const snapshot = await ordersCollection.where("customOrderId", "==", orderNumber).limit(1).get();
        if (snapshot.empty) {
            unique = true; // Found a unique number
        }
    }
    return orderNumber;
}


// ------------------------------
// ROUTES
// ------------------------------

// Get all orders
// Frontend should call: GET https://<cloud-function-url>/api/orders
app.get("/orders", async (req, res) => {
    try {
        const snapshot = await ordersCollection.get();
        const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(orders);
    } catch (err) {
        console.error("Error fetching orders:", err);
        res.status(500).json({ error: "Failed to fetch orders" });
    }
});

// Get a single order by Firestore document ID
// Frontend should call: GET https://<cloud-function-url>/api/orders/:id
app.get("/orders/:id", async (req, res) => {
    try {
        const docRef = ordersCollection.doc(req.params.id);
        const doc = await docRef.get();
        if (!doc.exists) {
            return res.status(404).json({ error: "Order not found" });
        }
        res.json({ id: doc.id, ...doc.data() });
    } catch (err) {
        console.error("Error fetching single order by Firestore ID:", err);
        res.status(500).json({ error: "Failed to fetch order" });
    }
});

// Get a single order by custom five-digit order ID (XX-XXX format)
// Frontend should call: GET https://<cloud-function-url>/api/orders/custom/:customOrderId
app.get("/orders/custom/:customOrderId", async (req, res) => {
    try {
        const customOrderId = req.params.customOrderId;
        const snapshot = await ordersCollection.where("customOrderId", "==", customOrderId).limit(1).get();

        if (snapshot.empty) {
            return res.status(404).json({ error: "Order not found with this custom ID" });
        }

        const doc = snapshot.docs[0];
        res.json({ id: doc.id, ...doc.data() });
    } catch (err) {
        console.error("Error fetching single order by custom ID:", err);
        res.status(500).json({ error: "Failed to fetch order by custom ID" });
    }
});


// Submit a new order
// Frontend should call: POST https://<cloud-function-url>/api/submit-order
app.post("/submit-order", async (req, res) => {
    try {
        const orderData = req.body;
        if (!orderData?.shippingInfo || !orderData?.estimatedQuote) {
            return res.status(400).json({ error: "Invalid order data" });
        }

        // Generate a unique five-digit order number
        const customOrderId = await generateUniqueFiveDigitOrderNumber();

        const docRef = await ordersCollection.add({
            ...orderData,
            customOrderId: customOrderId, // Store the custom formatted order ID
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: "pending_shipment"
        });
        // Return both the Firestore doc ID and the custom order ID
        res.status(201).json({ message: "Order submitted", orderId: docRef.id, customOrderId: customOrderId });
    } catch (err) {
        console.error("Error submitting order:", err);
        res.status(500).json({ error: "Failed to submit order" });
    }
});

/**
 * Helper function to create a shipping label using ShipEngine API.
 * This function can now be used for both initial labels (buyer to SwiftBuyBack)
 * and return labels (SwiftBuyBack to buyer) by setting the isReturnLabel flag.
 *
 * @param {object} order - The order data containing shipping information and customOrderId.
 * @param {boolean} [isReturnLabel=false] - If true, generates a return label (from SwiftBuyBack to buyer).
 * @returns {Promise<object>} The label data from ShipEngine.
 */
async function createShipStationLabel(order, isReturnLabel = false) {
    const isSandbox = true; // Reverted to true as per user request
    const buyerShippingInfo = order.shippingInfo;

    // Define SwiftBuyBack's fixed address for consistent use
    const swiftBuyBackAddress = {
        name: "SwiftBuyBack Returns",
        company_name: "SwiftBuyBack",
        phone: "555-555-5555", // Placeholder phone number
        address_line1: "1795 West 3rd St",
        city_locality: "Brooklyn",
        state_province: "NY",
        postal_code: "11223",
        country_code: "US"
    };

    // Construct the buyer's address from order data
    const buyerAddress = {
        name: buyerShippingInfo.fullName,
        phone: "555-555-5555", // Placeholder phone number, consider using actual buyer phone if available
        address_line1: buyerShippingInfo.streetAddress,
        city_locality: buyerShippingInfo.city,
        state_province: buyerShippingInfo.state,
        postal_code: buyerShippingInfo.zipCode,
        country_code: "US"
    };

    let shipFromAddress;
    let shipToAddress;

    if (isReturnLabel) {
        // For a return label, the shipment is FROM SwiftBuyBack TO the buyer
        shipFromAddress = swiftBuyBackAddress;
        shipToAddress = buyerAddress;
    } else {
        // For the initial label, the shipment is FROM the buyer TO SwiftBuyBack
        shipFromAddress = buyerAddress;
        shipToAddress = swiftBuyBackAddress;
    }

    // Use the custom five-digit order ID for tracking on the label
    const customOrderIdForLabel = order.customOrderId || 'N/A';

    const payload = {
        shipment: {
            service_code: "usps_priority_mail", // Or adjust as needed for returns
            ship_to: shipToAddress,
            ship_from: shipFromAddress,
            packages: [{
                weight: { value: 1, unit: "ounce" }, // Default weight, adjust if needed
                // Add the custom order ID to the label messages for easier tracking.
                // This will typically appear as a reference number on the physical label.
                label_messages: {
                    reference1: `OrderRef: ${customOrderIdForLabel}`
                }
            }]
        }
    };
    if (isSandbox) payload.testLabel = true; // Use test label for sandbox environment

    // IMPORTANT: Ensure you have configured this environment variable:
    // firebase functions:config:set shipengine.key="YOUR_SHIPENGINE_API_KEY"
    const shipEngineApiKey = functions.config().shipengine.key;
    if (!shipEngineApiKey) {
        throw new Error("ShipEngine API key not configured. Please set 'shipengine.key' environment variable.");
    }

    const response = await axios.post(
        "https://api.shipengine.com/v1/labels",
        payload, {
            headers: {
                "API-Key": shipEngineApiKey, // Using config object for ShipEngine API key
                "Content-Type": "application/json"
            }
        }
    );
    return response.data;
}

// Generate initial shipping label and send email to buyer
// Frontend should call: POST https://<cloud-function-url>/api/generate-label/:id
app.post("/generate-label/:id", async (req, res) => {
    try {
        const doc = await ordersCollection.doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: "Order not found" });

        const order = { id: doc.id, ...doc.data() };
        // Generate the initial label (buyer to SwiftBuyBack)
        const labelData = await createShipStationLabel(order, false); // Explicitly false for initial label

        const trackingNumber = labelData.tracking_number;

        await ordersCollection.doc(req.params.id).update({
            status: "label_generated",
            uspsLabelUrl: labelData.label_download?.pdf,
            trackingNumber: trackingNumber
        });

        const mailOptions = {
            from: functions.config().email.user,
            to: order.shippingInfo.email,
            subject: 'Your SwiftBuyBack Shipping Label',
            html: `
                <p>Hello ${order.shippingInfo.fullName},</p>
                <p>Your shipping label for order **${order.customOrderId}** is ready!</p>
                <p>Tracking Number: <strong>${trackingNumber || 'N/A'}</strong></p>
                <p>Please use the link below to download and print your label:</p>
                <a href="${labelData.label_download?.pdf}">Download Label</a>
                <p>Thank you,</p>
                <p>The SwiftBuyBack Team</p>
            `
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log('Shipping label email sent successfully with Nodemailer.');
        } catch (emailErr) {
            console.error('Failed to send shipping label email:', emailErr);
        }

        res.json({
            message: "Label generated",
            uspsLabelUrl: labelData.label_download?.pdf,
            trackingNumber: trackingNumber,
            customOrderId: order.customOrderId // Include custom order ID in response
        });
    } catch (err) {
        console.error("Error generating label:", err.response?.data || err);
        res.status(500).json({ error: "Failed to generate label" });
    }
});

// Update order status
// Frontend should call: PUT https://<cloud-function-url>/api/orders/:id/status
app.put("/orders/:id/status", async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) return res.status(400).json({ error: "Status is required" });
        await ordersCollection.doc(req.params.id).update({ status });
        res.json({ message: `Order marked as ${status}` });
    } catch (err) {
        console.error("Error updating status:", err);
        res.status(500).json({ error: "Failed to update status" });
    }
});

// Submit a re-offer (Updated to send email to customer via Zendesk)
// Frontend should call: POST https://<cloud-function-url>/api/orders/:id/re-offer
app.post("/orders/:id/re-offer", async (req, res) => {
    try {
        const { newPrice, reasons, comments } = req.body;
        const orderId = req.params.id; // This is the Firestore document ID

        if (!newPrice || !reasons || !Array.isArray(reasons) || reasons.length === 0) {
            return res.status(400).json({ error: "New price and at least one reason are required" });
        }
        const orderRef = ordersCollection.doc(orderId);
        const orderDoc = await orderRef.get();
        if (!orderDoc.exists) {
            return res.status(404).json({ error: "Order not found" });
        }
        const order = orderDoc.data();
        await orderRef.update({
            reOffer: {
                newPrice,
                reasons,
                comments,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                // Set auto-acceptance date 7 days from now
                autoAcceptDate: admin.firestore.Timestamp.fromMillis(Date.now() + (7 * 24 * 60 * 60 * 1000))
            },
            status: "re-offered-pending"
        });

        // HTML content for the Zendesk public comment
        let reasonString = reasons.join(', ');
        if (comments) {
            reasonString += `; ${comments}`;
        }
        const zendeskHtmlContent = `
        <div style="font-family: 'system-ui','-apple-system','BlinkMacSystemFont','Segoe UI','Roboto','Oxygen-Sans','Ubuntu','Cantarell','Helvetica Neue','Arial','sans-serif'; font-size: 14px; line-height: 1.5; color: #444444;">
          <h2 style="color: #0056b3; font-weight: bold; text-transform: none; font-size: 20px; line-height: 26px; margin: 5px 0 10px;">Hello ${order.shippingInfo.fullName},</h2>
          <p style="color: #2b2e2f; line-height: 22px; margin: 15px 0;">We've received your device for Order #${order.customOrderId} and after inspection, we have a revised offer for you.</p>
          <p style="color: #2b2e2f; line-height: 22px; margin: 15px 0;"><strong>Original Quote:</strong> $${order.estimatedQuote.toFixed(2)}</p>
          <p style="font-size: 1.2em; color: #d9534f; font-weight: bold; line-height: 22px; margin: 15px 0;">
            <strong>New Offer Price:</strong> $${newPrice.toFixed(2)}
          </p>
          <p style="color: #2b2e2f; line-height: 22px; margin: 15px 0;"><strong>Reason for New Offer:</strong></p>
          <p style="background-color: #f8f8f8; border-left-width: 5px; border-left-color: #d9534f; border-left-style: solid; color: #2b2e2f; line-height: 22px; margin: 15px 0; padding: 10px;">
            <em>"${reasonString}"</em>
          </p>
          <p style="color: #2b2e2f; line-height: 22px; margin: 15px 0;">Please review the new offer. You have two options:</p>
          <table width="100%" cellspacing="0" cellpadding="0" style="margin-top: 20px; border-collapse: collapse; font-size: 1em; width: 100%;">
            <tbody>
              <tr>
                <td align="center" style="vertical-align: top; padding: 0 10px;" valign="top">
                  <table cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; font-size: 1em;">
                    <tbody>
                      <tr>
                        <td style="border-radius: 5px; background-color: #a7f3d0; text-align: center; vertical-align: top; padding: 5px; border: 1px solid #ddd;" align="center" bgcolor="#a7f3d0" valign="top">
                          <a href="${functions.config().app.frontend_url}/reoffer-action.html?orderId=${orderId}&action=accept" style="border-radius: 5px; font-size: 16px; color: #065f46; text-decoration: none; font-weight: bold; display: block; padding: 15px 25px; border: 1px solid #6ee7b7;" rel="noreferrer">
                            Accept Offer ($${newPrice.toFixed(2)})
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td align="center" style="vertical-align: top; padding: 0 10px;" valign="top">
                  <table cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; font-size: 1em;">
                    <tbody>
                      <tr>
                        <td style="border-radius: 5px; background-color: #fecaca; text-align: center; vertical-align: top; padding: 5px; border: 1px solid #ddd;" align="center" bgcolor="#fecaca" valign="top">
                          <a href="${functions.config().app.frontend_url}/reoffer-action.html?orderId=${orderId}&action=return" style="border-radius: 5px; font-size: 16px; color: #991b1b; text-decoration: none; font-weight: bold; display: block; padding: 15px 25px; border: 1px solid #fca5a5;" rel="noreferrer">
                            Return Phone Now
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>
          <p style="color: #2b2e2f; line-height: 22px; margin: 30px 0 15px;">If you have any questions, please reply to this email.</p>
          <p style="color: #2b2e2f; line-height: 22px; margin: 15px 0;">Thank you,<br>The SwiftBuyBack Team</p>
        </div>
        `;

        const zendeskPayload = {
            ticket: {
                subject: `Re-offer for Order #${order.customOrderId} - New Offer!`,
                comment: {
                    html_body: zendeskHtmlContent,
                    public: true
                },
                priority: 'high',
                requester: { name: order.shippingInfo.fullName, email: order.shippingInfo.email }
            }
        };

        try {
            // IMPORTANT: Ensure you have configured these environment variables:
            // firebase functions:config:set zendesk.url="YOUR_ZENDESK_API_URL" zendesk.token="YOUR_BASE64_ENCODED_API_TOKEN"
            // firebase functions:config:set app.frontend_url="https://buyback-a0f05.web.app"
            const zendeskUrl = functions.config().zendesk.url;
            const zendeskToken = functions.config().zendesk.token;
            if (!zendeskUrl || !zendeskToken) {
                throw new Error("Zendesk configuration not complete. Please set 'zendesk.url' and 'zendesk.token'.");
            }
            await axios.post(zendeskUrl + '/tickets.json', zendeskPayload, {
                headers: {
                    'Authorization': `Basic ${zendeskToken}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log('Zendesk ticket created successfully.');
        } catch (zendeskErr) {
            console.error('Failed to create Zendesk ticket:', zendeskErr.response?.data || zendeskErr.message);
        }

        res.json({ message: "Re-offer submitted successfully", newPrice, customOrderId: order.customOrderId });
    } catch (err) {
        console.error("Error submitting re-offer:", err);
        res.status(500).json({ error: "Failed to submit re-offer" });
    }
});

// Generate return shipping label and send email to buyer
// Frontend should call: POST https://<cloud-function-url>/api/orders/:id/return-label
app.post("/orders/:id/return-label", async (req, res) => {
    try {
        const doc = await ordersCollection.doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: "Order not found" });
        const order = { id: doc.id, ...doc.data() };

        // Generate the return label (SwiftBuyBack to buyer)
        const returnLabelData = await createShipStationLabel(order, true); // Pass true for a return label

        const returnTrackingNumber = returnLabelData.tracking_number;

        await ordersCollection.doc(req.params.id).update({
            status: "return-label-generated",
            returnLabelUrl: returnLabelData.label_download?.pdf,
            returnTrackingNumber: returnTrackingNumber
        });

        const mailOptions = {
            from: functions.config().email.user,
            to: order.shippingInfo.email,
            subject: 'Your SwiftBuyBack Return Label',
            html: `
                <p>Hello ${order.shippingInfo.fullName},</p>
                <p>As requested, here is your return shipping label for your device (Order ID: ${order.customOrderId}):</p>
                <p>Return Tracking Number: <strong>${returnTrackingNumber || 'N/A'}</strong></p>
                <a href="${returnLabelData.label_download?.pdf}">Download Return Label</a>
                <p>Thank you,</p>
                <p>The SwiftBuyBack Team</p>
            `
        };
        await transporter.sendMail(mailOptions);

        res.json({
            message: "Return label generated successfully.",
            returnLabelUrl: returnLabelData.label_download?.pdf,
            returnTrackingNumber: returnTrackingNumber,
            customOrderId: order.customOrderId // Include custom order ID in response
        });
    } catch (err) {
        console.error("Error generating return label:", err.response?.data || err);
        res.status(500).json({ error: "Failed to generate return label" });
    }
});

// New endpoint to handle offer acceptance
// Frontend should call: POST https://<cloud-function-url>/api/accept-offer-action
app.post("/accept-offer-action", async (req, res) => {
    try {
        const { orderId } = req.body; // This is the Firestore document ID
        if (!orderId) {
            return res.status(400).json({ error: "Order ID is required" });
        }
        const docRef = ordersCollection.doc(orderId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return res.status(404).json({ error: "Order not found" });
        }

        const orderData = doc.data();
        if (orderData.status !== "re-offered-pending") {
            return res.status(409).json({ error: "This offer has already been accepted or declined." });
        }

        await docRef.update({
            status: "re-offered-accepted",
            acceptedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Send email as a Zendesk public comment for accepted offer
        const zendeskPayload = {
            ticket: {
                comment: {
                    html_body: `
                        <p>The customer has **accepted** the revised offer of **$${orderData.reOffer.newPrice.toFixed(2)}** for Order #${orderData.customOrderId}.</p>
                        <p>Please proceed with payment processing.</p>
                    `,
                    public: true
                },
                priority: 'high',
                requester: { name: orderData.shippingInfo.fullName, email: orderData.shippingInfo.email }
            }
        };

        try {
            const zendeskUrl = functions.config().zendesk.url;
            const zendeskToken = functions.config().zendesk.token;
            if (!zendeskUrl || !zendeskToken) {
                throw new Error("Zendesk configuration not complete. Please set 'zendesk.url' and 'zendesk.token'.");
            }
            await axios.post(zendeskUrl + '/tickets.json', zendeskPayload, {
                headers: {
                    'Authorization': `Basic ${zendeskToken}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log('Zendesk ticket comment for accepted offer created successfully.');
        } catch (zendeskErr) {
            console.error('Failed to create Zendesk ticket comment:', zendeskErr.response?.data || zendeskErr.message);
        }

        res.json({ message: "Offer accepted successfully.", customOrderId: orderData.customOrderId });
    } catch (err) {
        console.error("Error accepting offer:", err);
        res.status(500).json({ error: "Failed to accept offer" });
    }
});

// New endpoint to handle return requests
// Frontend should call: POST https://<cloud-function-url>/api/return-phone-action
app.post("/return-phone-action", async (req, res) => {
    try {
        const { orderId } = req.body; // This is the Firestore document ID
        if (!orderId) {
            return res.status(400).json({ error: "Order ID is required" });
        }
        const docRef = ordersCollection.doc(orderId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return res.status(404).json({ error: "Order not found" });
        }

        const orderData = doc.data();
        if (orderData.status !== "re-offered-pending") {
            return res.status(409).json({ error: "This offer has already been accepted or declined." });
        }

        // Renamed status to 're-offered-declined'
        await docRef.update({
            status: "re-offered-declined",
            declinedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Send email as a Zendesk public comment for declined offer (return request)
        const zendeskPayload = {
            ticket: {
                comment: {
                    html_body: `
                        <p>The customer has **declined** the revised offer for Order #${orderData.customOrderId} and has requested that their phone be returned.</p>
                        <p>Please initiate the return process and send a return shipping label.</p>
                    `,
                    public: true
                },
                priority: 'high',
                requester: { name: orderData.shippingInfo.fullName, email: orderData.shippingInfo.email }
            }
        };

        try {
            const zendeskUrl = functions.config().zendesk.url;
            const zendeskToken = functions.config().zendesk.token;
            if (!zendeskUrl || !zendeskToken) {
                throw new Error("Zendesk configuration not complete. Please set 'zendesk.url' and 'zendesk.token'.");
            }
            await axios.post(zendeskUrl + '/tickets.json', zendeskPayload, {
                headers: {
                    'Authorization': `Basic ${zendeskToken}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log('Zendesk ticket comment for return request created successfully.');
        } catch (zendeskErr) {
            console.error('Failed to create Zendesk ticket comment:', zendeskErr.response?.data || zendeskErr.message);
        }

        res.json({ message: "Return requested successfully.", customOrderId: orderData.customOrderId });
    } catch (err) {
        console.error("Error requesting return:", err);
        res.status(500).json({ error: "Failed to request return" });
    }
});

// New Cloud Function to run every 24 hours to check for expired offers
exports.autoAcceptOffers = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();
    const expiredOffers = await ordersCollection
        .where('status', '==', 're-offered-pending')
        .where('reOffer.autoAcceptDate', '<=', now)
        .get();

    const updates = expiredOffers.docs.map(async doc => { // Added async here
        const orderRef = ordersCollection.doc(doc.id);
        const orderData = doc.data();

        // Prepare Zendesk payload for auto-acceptance
        const zendeskPayload = {
            ticket: {
                comment: {
                    html_body: `
                        <p>The revised offer of **$${orderData.reOffer.newPrice.toFixed(2)}** for Order #${orderData.customOrderId} has been **auto-accepted** due to no response from the customer within the 7-day period.</p>
                        <p>Please proceed with payment processing.</p>
                    `,
                    public: true
                },
                priority: 'high',
                requester: { name: orderData.shippingInfo.fullName, email: orderData.shippingInfo.email }
            }
        };

        try { // Added try-catch for Zendesk call within map
            const zendeskUrl = functions.config().zendesk.url;
            const zendeskToken = functions.config().zendesk.token;
            if (!zendeskUrl || !zendeskToken) {
                throw new Error("Zendesk configuration not complete. Please set 'zendesk.url' and 'zendesk.token'.");
            }
            // Send a public comment to the Zendesk ticket
            await axios.post(zendeskUrl + '/tickets.json', zendeskPayload, {
                headers: {
                    'Authorization': `Basic ${zendeskToken}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`Zendesk ticket comment for auto-accept created for order ID: ${doc.customOrderId}`);
        } catch (err) {
            console.error(`Failed to create Zendesk ticket comment for auto-accept for order ID: ${doc.customOrderId}: ${err.response?.data || err.message}`);
        }


        console.log(`Auto-accepting expired offer for order ID: ${orderData.customOrderId}`);
        return orderRef.update({
            status: 're-offered-auto-accepted',
            acceptedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    });

    await Promise.all(updates);
    console.log(`Auto-accepted ${updates.length} expired offers.`);
    return null;
});

// Expose the Express app as a single Cloud Function
exports.api = functions.https.onRequest(app);
