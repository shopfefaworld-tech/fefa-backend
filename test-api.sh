#!/bin/bash

# API Testing Script for Fefa Backend
# Usage: ./test-api.sh <base-url> [auth-token]

BASE_URL=${1:-"https://fefa-backend.vercel.app"}
AUTH_TOKEN=${2:-""}

echo "========================================="
echo "Testing Fefa Backend API"
echo "Base URL: $BASE_URL"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to test endpoint
test_endpoint() {
    local method=$1
    local path=$2
    local description=$3
    local requires_auth=$4
    
    local url="${BASE_URL}${path}"
    local status_code
    
    echo -n "Testing $method $path ... "
    
    if [ "$requires_auth" = "true" ] && [ -z "$AUTH_TOKEN" ]; then
        echo -e "${YELLOW}SKIPPED (needs auth token)${NC}"
        return
    fi
    
    if [ "$method" = "GET" ]; then
        if [ -n "$AUTH_TOKEN" ]; then
            status_code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" "$url")
        else
            status_code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
        fi
    else
        if [ -n "$AUTH_TOKEN" ]; then
            status_code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Authorization: Bearer $AUTH_TOKEN" "$url")
        else
            status_code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url")
        fi
    fi
    
    if [ "$status_code" -ge 200 ] && [ "$status_code" -lt 300 ]; then
        echo -e "${GREEN}✓ OK ($status_code)${NC}"
    elif [ "$status_code" -eq 401 ] || [ "$status_code" -eq 403 ]; then
        echo -e "${YELLOW}⚠ Auth Required ($status_code)${NC}"
    elif [ "$status_code" -eq 404 ]; then
        echo -e "${RED}✗ NOT FOUND ($status_code)${NC}"
    else
        echo -e "${RED}✗ ERROR ($status_code)${NC}"
    fi
}

# Test public endpoints
echo "=== PUBLIC ENDPOINTS ==="
test_endpoint "GET" "/api/health" "Health check" false
test_endpoint "GET" "/api/endpoints" "Endpoints list" false
test_endpoint "GET" "/api/auth" "Auth API info" false
test_endpoint "GET" "/api/products" "Get products" false
test_endpoint "GET" "/api/categories" "Get categories" false
test_endpoint "GET" "/api/banners" "Get banners" false
test_endpoint "GET" "/api/reviews" "Get reviews" false
echo ""

# Test auth endpoints (will show auth required if no token)
echo "=== AUTHENTICATED ENDPOINTS ==="
test_endpoint "GET" "/api/users" "Get users (Admin)" true
test_endpoint "GET" "/api/auth/me" "Get current user" true
test_endpoint "GET" "/api/cart" "Get cart" true
test_endpoint "GET" "/api/orders" "Get orders" true
test_endpoint "GET" "/api/wishlist" "Get wishlist" true
echo ""

echo "========================================="
echo "Testing complete!"
echo ""
echo "To test authenticated endpoints, run:"
echo "./test-api.sh $BASE_URL <your-auth-token>"
echo "========================================="

