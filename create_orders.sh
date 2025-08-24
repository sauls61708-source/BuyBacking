#!/bin/bash

# --- Configuration ---
BACKEND_URL="https://us-central1-buyback-a0f05.cloudfunctions.net/api" # <-- REPLACE 'buyback-a0f05' with your actual Firebase Project ID
CUSTOMER_EMAIL="saulsetton191@gmail.com"
CUSTOMER_PHONE="9295845753"
CUSTOMER_NAME="Saul Setton"
SHIPPING_ADDRESS="123 Main St, Brooklyn, NY 11223"
VENMO_USERNAME="saulsetton" # Assuming Venmo is the payment method

# --- Arrays for varying order details ---
DEVICES=("iPhone 12" "iPhone 13" "iPhone 14" "iPhone 15" "Samsung S21" "Samsung S22" "Google Pixel 6" "Google Pixel 7" "iPad Air" "MacBook Air")
STORAGES=("64GB" "128GB" "256GB" "512GB")
CARRIERS=("Verizon" "AT&T" "T-Mobile" "Unlocked")

echo "Sending 10 order submission requests..."

for i in $(seq 1 10); do
    # Randomly select device, storage, and carrier
    RAND_DEVICE=${DEVICES[$((RANDOM % ${#DEVICES[@]}))]}
    RAND_STORAGE=${STORAGES[$((RANDOM % ${#STORAGES[@]}))]}
    RAND_CARRIER=${CARRIERS[$((RANDOM % ${#CARRIERS[@]}))]}
    
    # Generate a random estimated quote between 100 and 800
    RAND_QUOTE=$(( RANDOM % 701 + 100 ))

    JSON_PAYLOAD=$(cat <<EOF
{
  "shippingInfo": {
    "fullName": "${CUSTOMER_NAME}",
    "streetAddress": "123 Main St",
    "city": "Brooklyn",
    "state": "NY",
    "zipCode": "11223",
    "email": "${CUSTOMER_EMAIL}",
    "phone": "${CUSTOMER_PHONE}"
  },
  "device": "${RAND_DEVICE}",
  "storage": "${RAND_STORAGE}",
  "carrier": "${RAND_CARRIER}",
  "condition_power_on": "yes",
  "condition_functional": "yes",
  "condition_cracks": "no",
  "condition_cosmetic": "good",
  "paymentMethod": "venmo",
  "paymentDetails": {
    "venmoUsername": "${VENMO_USERNAME}"
  },
  "estimatedQuote": ${RAND_QUOTE}
}
EOF
)

    echo "--- Order $((i)) ---"
    echo "Device: ${RAND_DEVICE} ${RAND_STORAGE}, Carrier: ${RAND_CARRIER}, Quote: $${RAND_QUOTE}"
    
    # Send the curl request
    RESPONSE=$(curl -s -X POST \
      -H "Content-Type: application/json" \
      -d "$JSON_PAYLOAD" \
      "${BACKEND_URL}/api/submit-order")
    
    echo "Response: ${RESPONSE}"
    echo ""
done

echo "All 10 orders submitted."