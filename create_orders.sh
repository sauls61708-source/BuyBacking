#!/bin/bash

# --- Configuration ---
BACKEND_URL="https://us-central1-buyback-a0f05.cloudfunctions.net/api"

# --- Sample Data for Orders ---
declare -a NAMES=(
    "John Doe" "Jane Smith" "Alice Johnson" "Bob Brown" "Charlie Davis"
    "Diana Miller" "Eve White" "Frank Black" "Grace Green" "Henry Blue"
)
declare -a STREETS=(
    "101 Oak Ave" "202 Pine St" "303 Elm Rd" "404 Birch Blvd" "505 Cedar Ln"
    "606 Maple Dr" "707 Willow Way" "808 Spruce Ct" "909 Aspen Pl" "1010 Poplar Cir"
)
declare -a CITIES=(
    "Springfield" "Rivertown" "Brookside" "Fairview" "Greenville"
    "Centerville" "Lakeview" "Oakhaven" "Maplewood" "Pinecrest"
)
declare -a STATES=(
    "NY" "CA" "TX" "FL" "IL"
    "PA" "OH" "GA" "MI" "NC"
)
declare -a ZIPS=(
    "10001" "90210" "75001" "33101" "60601"
    "19019" "43004" "30303" "48103" "27510"
)
declare -a DEVICES=(
    "iPhone 12" "Samsung Galaxy S21" "Google Pixel 6" "iPhone 13" "Samsung Galaxy S22"
    "Google Pixel 7" "iPhone 14" "Samsung Galaxy S23" "Google Pixel 8" "iPhone 15"
)
declare -a STORAGES=(
    "64GB" "128GB" "256GB"
)
declare -a CARRIERS=(
    "Unlocked" "Verizon" "AT&T" "T-Mobile"
)

# --- Loop to Create and Update 10 Orders ---
echo "Starting to create and update 10 orders..."
echo "----------------------------------------"

for i in $(seq 0 9); do
    # Generate dynamic data for each order
    NAME="${NAMES[$i]}"
    EMAIL="customer${i}@example.com"
    STREET="${STREETS[$i]}"
    CITY="${CITIES[$i]}"
    STATE="${STATES[$i]}"
    ZIP="${ZIPS[$i]}"
    DEVICE="${DEVICES[$i]}"
    STORAGE="${STORAGES[$((i % ${#STORAGES[@]}))]}" # Cycle through storage options
    CARRIER="${CARRIERS[$((i % ${#CARRIERS[@]}))]}" # Cycle through carrier options
    QUOTE=$(( RANDOM % 500 + 200 )) # Random quote between $200 and $699

    # Simulate varied conditions
    CONDITION_POWER_ON=$([[ $((RANDOM % 10)) -lt 9 ]] && echo "Yes" || echo "No")
    CONDITION_FUNCTIONAL=$([[ $((RANDOM % 10)) -lt 8 ]] && echo "Yes" || echo "No")
    CONDITION_CRACKS=$([[ $((RANDOM % 10)) -lt 7 ]] && echo "No" || echo "Yes")
    CONDITION_COSMETIC=$([[ $((RANDOM % 10)) -lt 6 ]] && echo "Good" || echo "Fair")

    # 1. Submit the order
    echo "Submitting order for ${NAME}..."
    RESPONSE=$(curl -s -X POST "${BACKEND_URL}/submit-order" \
        -H "Content-Type: application/json" \
        -d '{
            "device": "'"${DEVICE}"'",
            "storage": "'"${STORAGE}"'",
            "carrier": "'"${CARRIER}"'",
            "condition_power_on": "'"${CONDITION_POWER_ON}"'",
            "condition_functional": "'"${CONDITION_FUNCTIONAL}"'",
            "condition_cracks": "'"${CONDITION_CRACKS}"'",
            "condition_cosmetic": "'"${CONDITION_COSMETIC}"'",
            "estimatedQuote": '"${QUOTE}"',
            "paymentMethod": "Venmo",
            "paymentDetails": {
                "venmoUsername": "@'"$(echo ${NAME} | tr -d ' ' | tr '[:upper:]' '[:lower:]')"'"
            },
            "shippingInfo": {
                "fullName": "'"${NAME}"'",
                "email": "'"${EMAIL}"'",
                "streetAddress": "'"${STREET}"'",
                "city": "'"${CITY}"'",
                "state": "'"${STATE}"'",
                "zipCode": "'"${ZIP}"'"
            }
        }')

    ORDER_ID=$(echo "${RESPONSE}" | grep -o '"orderId":"[^"]*"' | cut -d':' -f2 | tr -d '"')

    if [ -n "${ORDER_ID}" ]; then
        echo "  Order submitted successfully. Order ID: ${ORDER_ID}"

        # 2. Update the order status to "received"
        echo "  Updating status to 'received' for Order ID: ${ORDER_ID}..."
        UPDATE_RESPONSE=$(curl -s -X PUT "${BACKEND_URL}/orders/${ORDER_ID}/status" \
            -H "Content-Type: application/json" \
            -d '{"status": "received"}')
        
        if echo "${UPDATE_RESPONSE}" | grep -q "Order status updated to \"received\""; then
            echo "  Status updated to 'received' successfully."
        else
            echo "  Failed to update status for Order ID: ${ORDER_ID}. Response: ${UPDATE_RESPONSE}"
        fi
    else
        echo "  Failed to submit order for ${NAME}. Response: ${RESPONSE}"
    fi
    echo "----------------------------------------"
done

echo "Script finished."