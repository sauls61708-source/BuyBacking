import express from "express";
import cors from "cors";

const app = express();
const PORT = 3000;

app.use(cors()); // allow requests from any origin
app.use(express.json());

// Temporary in-memory "orders" database
let orders = [
    {
        id: "1001",
        device: "iPhone 13",
        carrier: "AT&T",
        storage: "128GB",
        condition_power_on: "Yes",
        condition_functional: "Yes",
        condition_cracks: "No",
        condition_cosmetic: "Minor scratches",
        estimatedQuote: 420.00,
        paymentMethod: "Venmo",
        paymentDetails: { venmoUsername: "@user123" },
        shippingInfo: {
            fullName: "John Doe",
            streetAddress: "123 Main St",
            city: "Brooklyn",
            state: "NY",
            zipCode: "11201",
            email: "john@example.com"
        },
        status: "pending_shipment",
        uspsLabelUrl: null
    }
];

// Get all orders
app.get("/api/orders", (req, res) => {
    res.json(orders);
});

// Get single order
app.get("/api/orders/:id", (req, res) => {
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
});

// Generate USPS label
app.post("/api/generate-label/:id", (req, res) => {
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Fake label URL
    order.uspsLabelUrl = `https://www.example.com/label/${order.id}`;
    order.status = "label_generated";

    res.json({
        message: "USPS label generated successfully",
        uspsLabelUrl: order.uspsLabelUrl
    });
});

// Update order status
app.put("/api/orders/:id/status", (req, res) => {
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const { status } = req.body;
    order.status = status;

    res.json({ message: `Order status updated to ${status}` });
});

app.listen(PORT, () => {
    console.log(`🚀 Backend running at http://localhost:${PORT}`);
});
