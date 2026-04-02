#!/bin/bash
# Elevate user to Admin
mongosh studyfriend --eval 'db.users.updateOne({email: "fix2@test.com"}, {$set: {isAdmin: true}})'

# Login to get JWT
RESPONSE=$(curl -s -X POST http://localhost:5001/api/auth/login -H "Content-Type: application/json" -d '{"email": "fix2@test.com", "password": "password123"}')
TOKEN=$(echo $RESPONSE | grep -o '"token":"[^"]*' | cut -d '"' -f 4)

echo -e "\n\nGot Admin Token: ${TOKEN:0:15}..."

# Fetch all users via Admin protected endpoint
echo -e "\n\nFetching users via /api/admin/users..."
curl -s -X GET http://localhost:5001/api/admin/users -H "Authorization: Bearer $TOKEN" | grep -o '"_id"' | wc -l | awk '{print "Total users retrieved: " $1}'
