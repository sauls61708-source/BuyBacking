const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");

const app = express();

// Define allowed origins for CORS. Ensure your frontend URL is included.
const allowedOrigins = [
  "https://toratyosef.github.io",
  "https://buyback-a0f05.web.app"
];

// Apply CORS middleware to all routes
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"], // Explicitly allow Content-Type and Authorization headers
  })
);
app.use(express.json());

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();
const ordersCollection = db.collection("orders");

// ------------------------------
// Zendesk Configuration
// ------------------------------
const ZENDESK_API_TOKEN = functions.config().zendesk.token;
const ZENDESK_SUBDOMAIN = functions.config().zendesk.subdomain;
const ZENDESK_USER = functions.config().zendesk.user; // Typically an agent's email

// ------------------------------
// Zendesk Helper Function (Internal Admin Notification)
// This function creates a new ticket in Zendesk for internal re-offer notifications.
// It will now be created as an internal note to prevent email notifications.
// ------------------------------
async function createZendeskInternalTicket(orderId, newPrice, reason) {
  try {
    const ticketData = {
      ticket: {
        subject: `Internal: New Offer for Order #${orderId}`, // Clarified subject for internal ticket
        comment: {
          body: `Order #${orderId} requires a re-offer.
New Price: $${newPrice.toFixed(2)}
Reason: ${reason}
`,
          public: false, // <--- IMPORTANT CHANGE: Set to false for internal notes
        },
        priority: "high",
        tags: ["re-offer", "swiftbuyback", "internal-notification"], // Added internal tag
      },
    };

    const response = await axios.post(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets.json`,
      ticketData,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            `${ZENDESK_USER}/token:${ZENDESK_API_TOKEN}`
          ).toString("base64")}`,
        },
      }
    );
    console.log(`Internal Zendesk ticket created for Order #${orderId} (as private note).`);
    return response.data;
  } catch (err) {
    console.error("Zendesk internal ticket creation failed:", err.response?.data || err);
    throw new Error("Failed to create Zendesk internal ticket.");
  }
}

// ------------------------------
// Zendesk Helper Function (Send Re-offer Email to Buyer)
// This function creates a new Zendesk ticket with the buyer as the requester,
// and the HTML content as a public comment, effectively sending an email.
// ------------------------------
async function sendBuyerReofferEmailViaZendesk(orderId, buyerEmail, orderDetails, newPrice, reason) {
  // Frontend URL must be configured for the action links
  // firebase functions:config:set app.frontend_url="https://buyback-a0f05.web.app"
  // Links now point to the single reoffer-action.html page
  const reofferActionPage = `${functions.config().app.frontend_url}/reoffer-action.html?orderId=${orderId}`;
  const acceptLink = reofferActionPage; // Both buttons go to the same page
  const returnLink = reofferActionPage; // Both buttons go to the same page

  // Ensure buyerName is never empty, providing a fallback
  const buyerName = orderDetails.shippingInfo.fullName || 'Customer'; 

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #0056b3;">Hello ${buyerName},</h2>
      <p>We've received your device for Order #${orderId} and after inspection, we have a revised offer for you.</p>
      
      <p><strong>Original Quote:</strong> $${orderDetails.estimatedQuote.toFixed(2)}</p>
      <p style="font-size: 1.2em; color: #d9534f; font-weight: bold;">
        <strong>New Offer Price:</strong> $${newPrice.toFixed(2)}
      </p>
      
      <p><strong>Reason for New Offer:</strong></p>
      <p style="background-color: #f8f8f8; padding: 10px; border-left: 5px solid #d9534f;">
        <em>"${reason}"</em>
      </p>
      
      <p>Please review the new offer. You have two options:</p>
      
      <table width="100%" cellspacing="0" cellpadding="0" style="margin-top: 20px;">
        <tr>
          <td align="center" style="padding: 0 10px;"> <!-- Added padding to td for spacing -->
            <table cellspacing="0" cellpadding="0" style="width: 100%;">
              <tr>
                <td style="border-radius: 5px; background-color: #a7f3d0; text-align: center;"> <!-- Lighter green background -->
                  <a href="${acceptLink}" target="_blank" style="padding: 15px 25px; border: 1px solid #6ee7b7; border-radius: 5px; font-family: Arial, sans-serif; font-size: 16px; color: #065f46; text-decoration: none; font-weight: bold; display: block;">
                    Accept Offer ($${newPrice.toFixed(2)})
                  </a>
                </td>
              </tr>
            </table>
          </td>
          <td align="center" style="padding: 0 10px;"> <!-- Added padding to td for spacing -->
            <table cellspacing="0" cellpadding="0" style="width: 100%;">
              <tr>
                <td style="border-radius: 5px; background-color: #fecaca; text-align: center;"> <!-- Lighter red background -->
                  <a href="${returnLink}" target="_blank" style="padding: 15px 25px; border: 1px solid #fca5a5; border-radius: 5px; font-family: Arial, sans-serif; font-size: 16px; color: #991b1b; text-decoration: none; font-weight: bold; display: block;">
                    Return Phone Now
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <p style="margin-top: 30px;">If you have any questions, please reply to this email.</p>
      <p>Thank you,<br>The SwiftBuyBack Team</p>
    </div>
  `;

  try {
    const ticketData = {
      ticket: {
        requester: { email: buyerEmail, name: buyerName }, // Use the potentially defaulted buyerName
        subject: `Your SwiftBuyBack Order #${orderId} - New Offer!`, // Email subject
        comment: {
          html_body: htmlContent, // HTML content for the email
          public: true, // Make this a public comment, which sends it as an email
        },
        priority: "normal", // Set an appropriate priority
        tags: ["re-offer", "swiftbuyback", "customer-email"], // Tags for this email ticket
      },
    };

    const response = await axios.post(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets.json`,
      ticketData,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            `${ZENDESK_USER}/token:${ZENDESK_API_TOKEN}`
          ).toString("base64")}`,
        },
      }
    );
    console.log(`Re-offer email sent via Zendesk to ${buyerEmail} for Order #${orderId} (Ticket ID: ${response.data.ticket.id})`);
    // Store the Zendesk Ticket ID in the Firestore order document
    await ordersCollection.doc(orderId).update({
      zendeskTicketId: response.data.ticket.id
    });
    return response.data;
  } catch (err) {
    console.error(`Failed to send re-offer email via Zendesk to ${buyerEmail} for Order #${orderId}:`, err.response?.data || err);
    throw new Error("Failed to send re-offer email via Zendesk.");
  }
}

// ------------------------------
// Zendesk Helper Function (Send Custom Email to Buyer)
// This function creates a new Zendesk ticket with a custom subject and body,
// sent to the buyer as a public comment.
// ------------------------------
async function sendCustomEmailViaZendesk(orderId, buyerEmail, buyerName, subject, body) {
  // Ensure buyerName is never empty, providing a fallback
  const formattedBuyerName = buyerName || 'Customer';

  try {
    const ticketData = {
      ticket: {
        requester: { email: buyerEmail, name: formattedBuyerName }, // Use the potentially defaulted buyerName
        subject: subject,
        comment: {
          html_body: `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">${body}</div>`,
          public: true,
        },
        priority: "normal",
        tags: ["swiftbuyback", "customer-custom-email"],
      },
    };

    const response = await axios.post(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets.json`,
      ticketData,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            `${ZENDESK_USER}/token:${ZENDESK_API_TOKEN}`
          ).toString("base64")}`,
        },
      }
    );
    console.log(`Custom email sent via Zendesk to ${buyerEmail} for Order #${orderId} (Ticket ID: ${response.data.ticket.id})`);
    // Store the Zendesk Ticket ID in the Firestore order document if it's a new ticket
    // This assumes custom emails might also initiate a new ticket for a conversation thread
    await ordersCollection.doc(orderId).update({
      zendeskTicketId: response.data.ticket.id // Store the new ticket ID
    }, { merge: true }); // Use merge to avoid overwriting other fields
    return response.data;
  } catch (err) {
    console.error(`Failed to send custom email via Zendesk to ${buyerEmail} for Order #${orderId}:`, err.response?.data || err);
    throw new Error("Failed to send custom email via Zendesk.");
  }
}


// ------------------------------
// Zendesk Helper Function (Add Comment to Existing Ticket)
// This function adds a public comment to an existing Zendesk ticket.
// ------------------------------
async function addCommentToZendeskTicket(zendeskTicketId, commentBody, buyerEmail, buyerName) {
  try {
    const commentData = {
      ticket: {
        comment: {
          body: commentBody,
          public: true, // Make this a public comment
        },
      }
    };

    const response = await axios.put(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${zendeskTicketId}.json`,
      commentData,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            `${ZENDESK_USER}/token:${ZENDESK_API_TOKEN}`
          ).toString("base64")}`,
        },
      }
    );
    console.log(`Comment added to Zendesk Ticket #${zendeskTicketId} by ${buyerName}.`);
    return response.data;
  } catch (err) {
    console.error(`Failed to add comment to Zendesk Ticket #${zendeskTicketId}:`, err.response?.data || err);
    throw new Error("Failed to add comment to Zendesk ticket.");
  }
}


// ------------------------------
// ShipStation Helper Function (Generate Outgoing Label)
// This function creates a shipment and generates a shipping label from SwiftBuyBack to the customer.
// ------------------------------
const SHIPSTATION_API_KEY = functions.config().shipstation.key;

async function createShipmentAndLabel(orderId, orderDetails) {
  // Validate essential shipping info
  const shippingInfo = orderDetails?.shippingInfo;
  if (!shippingInfo || 
      !shippingInfo.fullName || shippingInfo.fullName.trim() === '' ||
      !shippingInfo.streetAddress || shippingInfo.streetAddress.trim() === '' ||
      !shippingInfo.city || shippingInfo.city.trim() === '' ||
      !shippingInfo.state || shippingInfo.state.trim() === '' ||
      !shippingInfo.postalCode || shippingInfo.postalCode.trim() === '') {
    throw new Error("Missing or incomplete customer shipping information for label generation.");
  }

  try {
    const shipmentData = {
      shipment: {
        serviceCode: "usps_priority_mail", // Ensure service code is always present
        shipFrom: {
          name: shippingInfo.fullName,
          addressLine1: shippingInfo.streetAddress,
          cityLocality: shippingInfo.city,
          stateProvince: shippingInfo.state,
          postalCode: shippingInfo.postalCode,
          countryCode: "US",
        },
        shipTo: {
          name: "SwiftBuyBack",
          addressLine1: "1795 west 3rd st",
          cityLocality: "Anytown",
          stateProvince: "CA",
          postalCode: "90210",
          countryCode: "US",
        },
        packages: [
          {
            weight: {
              value: 1,
              unit: "pound",
            },
          },
        ],
      },
    };

    const url = "https://api.shipengine.com/v1/labels";
    const headers = {
      "Content-Type": "application/json",
      "API-Key": SHIPSTATION_API_KEY,
    };

    const response = await axios.post(url, shipmentData, { headers });
    return response.data.label_download.pdf;
  } catch (err) {
    console.error("ShipStation label generation failed:", JSON.stringify(err.response?.data) || err);
    throw new Error("Failed to generate shipping label.");
  }
}

// ------------------------------
// NEW ShipStation Helper Function (Generate Return Label from Business to Customer)
// This function creates a return shipping label from SwiftBuyBack to the customer.
// ------------------------------
async function createReturnLabel(orderId, orderDetails) {
  // Validate essential shipping info
  const shippingInfo = orderDetails?.shippingInfo;
  if (!shippingInfo || 
      !shippingInfo.fullName || shippingInfo.fullName.trim() === '' ||
      !shippingInfo.streetAddress || shippingInfo.streetAddress.trim() === '' ||
      !shippingInfo.city || shippingInfo.city.trim() === '' ||
      !shippingInfo.state || shippingInfo.state.trim() === '' ||
      !shippingInfo.postalCode || shippingInfo.postalCode.trim() === '') {
    throw new Error("Missing or incomplete customer shipping information for return label generation.");
  }

  try {
    const shipmentData = {
      shipment: {
        serviceCode: "usps_priority_mail", // Or another suitable return service
        shipFrom: { // SwiftBuyBack is sending the phone back
          name: "SwiftBuyBack",
          addressLine1: "1795 west 3rd st",
          cityLocality: "Anytown",
          stateProvince: "CA",
          postalCode: "90210",
          countryCode: "US",
        },
        shipTo: { // Customer is receiving the phone back
          name: shippingInfo.fullName,
          addressLine1: shippingInfo.streetAddress,
          cityLocality: shippingInfo.city,
          stateProvince: shippingInfo.state,
          postalCode: shippingInfo.postalCode,
          countryCode: "US",
        },
        packages: [
          {
            weight: {
              value: 1,
              unit: "pound",
            },
          },
        ],
      },
    };

    const url = "https://api.shipengine.com/v1/labels";
    const headers = {
      "Content-Type": "application/json",
      "API-Key": SHIPSTATION_API_KEY,
    };

    const response = await axios.post(url, shipmentData, { headers });
    return response.data.label_download.pdf;
  } catch (err) {
    console.error("ShipStation return label generation failed:", JSON.stringify(err.response?.data) || err);
    throw new Error("Failed to generate return shipping label.");
  }
}


// ------------------------------
// API ROUTES
// ------------------------------

// GET all orders
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

// GET a single order by ID
app.get("/orders/:id", async (req, res) => {
  try {
    const docRef = ordersCollection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error("Error fetching single order:", err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// POST a new order
app.post("/submit-order", async (req, res) => {
  try {
    const orderData = req.body;
    if (!orderData?.shippingInfo || !orderData?.estimatedQuote) {
      return res.status(400).json({ error: "Invalid order data: missing shippingInfo or estimatedQuote" });
    }

    const docRef = await ordersCollection.add({
      ...orderData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending_shipment"
    });

    res.status(201).json({ message: "Order submitted", orderId: docRef.id });
  } catch (err) {
    console.error("Error submitting order:", err);
    res.status(500).json({ error: "Failed to submit order" });
  }
});

// PUT (update) an order with a re-offer
app.put("/orders/:id/reoffer", async (req, res) => {
  try {
    const { newPrice, reason } = req.body;
    if (!newPrice || !reason) {
      return res.status(400).json({ error: "New price and reason are required" });
    }

    const docRef = ordersCollection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });
    const orderData = doc.data();

    const reofferDetails = {
      newPrice: parseFloat(newPrice),
      reason: reason,
      reofferedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await docRef.update({
      status: "re-offered",
      reofferDetails: reofferDetails
    });

    // Create an internal Zendesk ticket for admin notification (now as a private note)
    await createZendeskInternalTicket(req.params.id, reofferDetails.newPrice, reofferDetails.reason);

    // Send re-offer email to the buyer via Zendesk and store the ticket ID
    const buyerEmail = orderData.shippingInfo.email;
    if (buyerEmail) {
      await sendBuyerReofferEmailViaZendesk(req.params.id, buyerEmail, orderData, reofferDetails.newPrice, reofferDetails.reason);
    } else {
      console.warn(`No email found for order #${req.params.id}. Re-offer email not sent via Zendesk.`);
    }

    res.json({ message: "Re-offer successfully submitted, internal Zendesk ticket created, and email sent to buyer via Zendesk." });
  } catch (err) {
    console.error("Error creating re-offer:", err.response?.data || err);
    res.status(500).json({ error: "Failed to create re-offer" });
  }
});

// POST to generate a shipping label for an order
app.post("/generate-label/:id", async (req, res) => {
  try {
    const docRef = ordersCollection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });
    const order = { id: doc.id, ...doc.data() };

    const uspsLabelUrl = await createShipmentAndLabel(order.id, order);

    await docRef.update({
      status: "label_generated",
      uspsLabelUrl: uspsLabelUrl,
    });

    res.status(200).json({ message: "Label generated successfully.", uspsLabelUrl });
  } catch (err) {
    console.error("Error generating label:", err);
    res.status(500).json({ error: err.message || "Failed to generate label." });
  }
});

// NEW ROUTE: POST to send a custom email to the buyer via Zendesk
app.post("/orders/:id/send-custom-email", async (req, res) => {
  try {
    const { subject, body } = req.body;
    if (!subject || !body) {
      return res.status(400).json({ error: "Email subject and body are required." });
    }

    const docRef = ordersCollection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found." });
    const orderData = doc.data();

    const buyerEmail = orderData.shippingInfo.email;
    const buyerName = orderData.shippingInfo.fullName;
    const zendeskTicketId = orderData.zendeskTicketId; // Get existing ticket ID

    if (buyerEmail) {
      if (zendeskTicketId) {
        // If an existing ticket is found, add a comment to it
        await addCommentToZendeskTicket(zendeskTicketId, `Custom email from admin: ${body}`, buyerEmail, buyerName);
        res.status(200).json({ message: "Custom email sent as a comment to existing Zendesk ticket." });
      } else {
        // If no existing ticket, create a new one
        await sendCustomEmailViaZendesk(req.params.id, buyerEmail, buyerName, subject, body);
        res.status(200).json({ message: "Custom email sent successfully via Zendesk (new ticket created)." });
      }
    } else {
      console.warn(`No email found for order #${req.params.id}. Custom email not sent.`);
      res.status(400).json({ error: "Buyer email not found for this order." });
    }
  } catch (err) {
    console.error("Error sending custom email:", err.response?.data || err);
    res.status(500).json({ error: "Failed to send custom email." });
  }
});

// NEW ROUTE: POST to add a buyer's reply to an existing Zendesk ticket
app.post("/orders/:id/add-buyer-reply", async (req, res) => {
  const { orderId } = req.params;
  const { replyMessage } = req.body;

  if (!replyMessage) {
    return res.status(400).json({ error: "Reply message is required." });
  }

  try {
    const docRef = ordersCollection.doc(orderId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Order not found." });
    }

    const orderData = doc.data();
    const zendeskTicketId = orderData.zendeskTicketId;
    const buyerEmail = orderData.shippingInfo?.email || 'unknown@example.com';
    const buyerName = orderData.shippingInfo?.fullName || 'Customer';

    if (!zendeskTicketId) {
      console.warn(`No Zendesk Ticket ID found for Order #${orderId}. Cannot add reply.`);
      return res.status(400).json({ error: "No associated Zendesk ticket found for this order." });
    }

    await addCommentToZendeskTicket(zendeskTicketId, `Buyer's Reply: ${replyMessage}`, buyerEmail, buyerName);

    res.status(200).json({ message: "Reply sent successfully." });
  } catch (err) {
    console.error(`Error adding buyer reply for Order #${orderId}:`, err);
    res.status(500).json({ error: "Failed to process your request to add reply." });
  }
});


// NEW API ENDPOINT: POST to handle the 'Accept Offer' action from the static page
app.post("/api/accept-offer-action", async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: "Order ID is required." });
  }

  try {
    const docRef = ordersCollection.doc(orderId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Order not found." });
    }

    const orderData = doc.data();
    const newPrice = orderData.reofferDetails?.newPrice || orderData.estimatedQuote;
    const reason = orderData.reofferDetails?.reason || 'N/A';
    const buyerName = orderData.shippingInfo?.fullName || 'Customer';
    const buyerEmail = orderData.shippingInfo?.email || 'unknown@example.com';
    const zendeskTicketId = orderData.zendeskTicketId;

    await docRef.update({
      status: "offer_accepted",
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (zendeskTicketId) {
      await addCommentToZendeskTicket(zendeskTicketId, `Buyer (${buyerName}) has accepted the new offer of $${newPrice.toFixed(2)} for Order #${orderId}. Reason for re-offer: "${reason}".`, buyerEmail, buyerName);
    }

    res.status(200).json({ message: "Offer accepted successfully." });
  } catch (err) {
    console.error(`Error accepting offer action for Order #${orderId}:`, err);
    res.status(500).json({ error: "Failed to process your request to accept the offer." });
  }
});

// NEW API ENDPOINT: POST to handle the 'Return Phone' action from the static page
app.post("/api/return-phone-action", async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: "Order ID is required." });
  }

  try {
    const docRef = ordersCollection.doc(orderId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Order not found." });
    }

    const orderData = doc.data();
    const newPrice = orderData.reofferDetails?.newPrice || orderData.estimatedQuote;
    const reason = orderData.reofferDetails?.reason || 'N/A';
    const buyerName = orderData.shippingInfo?.fullName || 'Customer';
    const buyerEmail = orderData.shippingInfo?.email || 'unknown@example.com';
    const zendeskTicketId = orderData.zendeskTicketId;

    await docRef.update({
      status: "return_requested",
      returnRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (zendeskTicketId) {
      await addCommentToZendeskTicket(zendeskTicketId, `Buyer (${buyerName}) has declined the new offer of $${newPrice.toFixed(2)} and requested phone return for Order #${orderId}. Reason for re-offer: "${reason}".`, buyerEmail, buyerName);
    }

    res.status(200).json({ message: "Return phone requested successfully." });
  } catch (err) {
    console.error(`Error requesting phone return action for Order #${orderId}:`, err);
    res.status(500).json({ error: "Failed to process your request to return the phone." });
  }
});

// NEW API ENDPOINT: POST to generate a return shipping label (from business to customer)
app.post("/api/generate-return-label/:id", async (req, res) => {
  try {
    const docRef = ordersCollection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });
    const order = { id: doc.id, ...doc.data() };

    const returnLabelUrl = await createReturnLabel(order.id, order); // Use the new helper function

    await docRef.update({
      status: "return_label_generated", // New status for return label
      returnLabelUrl: returnLabelUrl,
    });

    res.status(200).json({ message: "Return label generated successfully.", returnLabelUrl });
  } catch (err) {
    console.error("Error generating return label:", err);
    res.status(500).json({ error: err.message || "Failed to generate return label." });
  }
});


// Export the Express app as a Firebase Cloud Function
exports.api = functions.https.onRequest(app);
