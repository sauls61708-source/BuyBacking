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
  const acceptLink = `${functions.config().app.frontend_url}/accept-offer?orderId=${orderId}`;
  const returnLink = `${functions.config().app.frontend_url}/return-phone?orderId=${orderId}`;

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
          <td align="center">
            <table cellspacing="0" cellpadding="0">
              <tr>
                <td style="border-radius: 5px;" bgcolor="#5cb85c">
                  <a href="${acceptLink}" target="_blank" style="padding: 10px 20px; border: 1px solid #5cb85c; border-radius: 5px; font-family: Arial, sans-serif; font-size: 15px; color: #ffffff; text-decoration: none; font-weight: bold; display: inline-block;">
                    Accept Offer ($${newPrice.toFixed(2)})
                  </a>
                </td>
                <td width="20">&nbsp;</td> <!-- Spacer -->
                <td style="border-radius: 5px;" bgcolor="#d9534f">
                  <a href="${returnLink}" target="_blank" style="padding: 10px 20px; border: 1px solid #d9534f; border-radius: 5px; font-family: Arial, sans-serif; font-size: 15px; color: #ffffff; text-decoration: none; font-weight: bold; display: inline-block;">
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
    return response.data;
  } catch (err) {
    console.error(`Failed to send custom email via Zendesk to ${buyerEmail} for Order #${orderId}:`, err.response?.data || err);
    throw new Error("Failed to send custom email via Zendesk.");
  }
}


// ------------------------------
// ShipStation Helper Function
// This function creates a shipment and generates a shipping label using ShipEngine API.
// ------------------------------
const SHIPSTATION_API_KEY = functions.config().shipstation.key;

async function createShipmentAndLabel(orderId, orderDetails) {
  try {
    const shipmentData = {
      shipment: {
        serviceCode: "usps_priority_mail",
        shipFrom: {
          name: orderDetails.shippingInfo.fullName,
          addressLine1: orderDetails.shippingInfo.streetAddress,
          cityLocality: orderDetails.shippingInfo.city,
          stateProvince: orderDetails.shippingInfo.state,
          postalCode: orderDetails.shippingInfo.zipCode,
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
    console.error("ShipStation label generation failed:", err.response?.data || err);
    throw new Error("Failed to generate shipping label.");
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

    // Send re-offer email to the buyer via Zendesk
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

    if (buyerEmail) {
      await sendCustomEmailViaZendesk(req.params.id, buyerEmail, buyerName, subject, body);
      res.status(200).json({ message: "Custom email sent successfully via Zendesk." });
    } else {
      console.warn(`No email found for order #${req.params.id}. Custom email not sent.`);
      res.status(400).json({ error: "Buyer email not found for this order." });
    }
  } catch (err) {
    console.error("Error sending custom email:", err.response?.data || err);
    res.status(500).json({ error: "Failed to send custom email." });
  }
});


// PUT (update) the status of an order
app.put("/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required." });

    const docRef = ordersCollection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found." });

    await docRef.update({
      status: status
    });

    res.status(200).json({ message: `Order status updated to "${status}".` });
  } catch (err) {
    console.error("Error updating status:", err);
    res.status(500).json({ error: "Failed to update status." });
  }
});

// ------------------------------
// Buyer Action Endpoints
// These endpoints are triggered when a buyer clicks a button in the re-offer email.
// ------------------------------

// Endpoint for buyer to accept the re-offer
app.get("/accept-offer", async (req, res) => {
  const { orderId } = req.query;

  if (!orderId) {
    return res.status(400).send("Error: Order ID is required.");
  }

  try {
    const docRef = ordersCollection.doc(orderId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send("Error: Order not found.");
    }

    const orderData = doc.data();
    const newPrice = orderData.reofferDetails?.newPrice || orderData.estimatedQuote;
    const reason = orderData.reofferDetails?.reason || 'N/A';
    const buyerName = orderData.shippingInfo?.fullName || 'Customer';

    await docRef.update({
      status: "offer_accepted",
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).send(`
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f9f9f9;">
        <h2 style="color: #28a745; font-size: 2.5em; margin-bottom: 20px;">Offer Accepted! &#x2705;</h2>
        <p style="font-size: 1.1em; color: #555;">Hello ${buyerName},</p>
        <p style="font-size: 1.1em; color: #555;">Thank you for accepting the new offer for your Order <strong>#${orderId}</strong>.</p>
        <div style="background-color: #e6ffe6; border: 1px solid #c3e6cb; border-radius: 8px; padding: 20px; margin: 30px auto; max-width: 500px;">
          <p style="font-size: 1.2em; font-weight: bold; color: #28a745; margin-bottom: 10px;">
            Accepted Offer: $${newPrice.toFixed(2)}
          </p>
          <p style="font-size: 0.9em; color: #666;">
            Reason for re-offer: <em>${reason}</em>
          </p>
        </div>
        <p style="font-size: 1.1em; color: #555;">We will process your payment shortly.</p>
        <p style="margin-top: 30px;">
          <a href="${functions.config().app.frontend_url}" style="color: #007bff; text-decoration: none; font-weight: bold;">Return to SwiftBuyBack Homepage</a>
        </p>
      </div>
    `);
  } catch (err) {
    console.error(`Error accepting offer for Order #${orderId}:`, err);
    res.status(500).send(`
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f9f9f9;">
        <h2 style="color: #dc3545; font-size: 2.5em; margin-bottom: 20px;">Error! &#x274C;</h2>
        <p style="font-size: 1.1em; color: #555;">There was an error processing your request to accept the offer for Order <strong>#${orderId}</strong>.</p>
        <p style="font-size: 1.1em; color: #555;">Please try again or contact support.</p>
        <p style="margin-top: 30px;">
          <a href="${functions.config().app.frontend_url}" style="color: #007bff; text-decoration: none; font-weight: bold;">Return to SwiftBuyBack Homepage</a>
        </p>
      </div>
    `);
  }
});

// Endpoint for buyer to reject the re-offer and request phone return
app.get("/return-phone", async (req, res) => {
  const { orderId } = req.query;

  if (!orderId) {
    return res.status(400).send("Error: Order ID is required.");
  }

  try {
    const docRef = ordersCollection.doc(orderId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send("Error: Order not found.");
    }

    const orderData = doc.data();
    const newPrice = orderData.reofferDetails?.newPrice || orderData.estimatedQuote;
    const reason = orderData.reofferDetails?.reason || 'N/A';
    const buyerName = orderData.shippingInfo?.fullName || 'Customer';

    await docRef.update({
      status: "return_requested",
      returnRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).send(`
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f9f9f9;">
        <h2 style="color: #dc3545; font-size: 2.5em; margin-bottom: 20px;">Phone Return Requested &#x274C;</h2>
        <p style="font-size: 1.1em; color: #555;">Hello ${buyerName},</p>
        <p style="font-size: 1.1em; color: #555;">You have requested your phone to be returned for Order <strong>#${orderId}</strong>.</p>
        <div style="background-color: #fff0f0; border: 1px solid #f5c6cb; border-radius: 8px; padding: 20px; margin: 30px auto; max-width: 500px;">
          <p style="font-size: 1.2em; font-weight: bold; color: #dc3545; margin-bottom: 10px;">
            Declined Offer: $${newPrice.toFixed(2)}
          </p>
          <p style="font-size: 0.9em; color: #666;">
            Reason for re-offer: <em>${reason}</em>
          </p>
        </div>
        <p style="font-size: 1.1em; color: #555;">We will process the return shipment shortly.</p>
        <p style="margin-top: 30px;">
          <a href="${functions.config().app.frontend_url}" style="color: #007bff; text-decoration: none; font-weight: bold;">Return to SwiftBuyBack Homepage</a>
        </p>
      </div>
    `);
  } catch (err) {
    console.error(`Error requesting phone return for Order #${orderId}:`, err);
    res.status(500).json({ error: "Failed to process your request to return the phone." });
  }
});


// Export the Express app as a Firebase Cloud Function
exports.api = functions.https.onRequest(app);
