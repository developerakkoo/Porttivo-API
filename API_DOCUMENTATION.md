# Porttivo Backend API Documentation

Complete API documentation for the Porttivo Transporter App.

## Table of Contents

1. [Base Configuration](#base-configuration)
2. [Authentication](#authentication)
3. [Transporter Profile](#transporter-profile)
4. [Vehicle Management](#vehicle-management)
5. [Driver Management](#driver-management)
6. [Trip Management](#trip-management)
7. [Fuel Management](#fuel-management)
8. [Error Handling](#error-handling)
9. [Socket.IO Events](#socketio-events)

---

## Base Configuration

### Base URL
```
http://localhost:3000/api
```

### Authentication Header
For protected endpoints, include the JWT token in the Authorization header:
```
Authorization: Bearer <access_token>
```

### Response Format
All API responses follow this structure:
```json
{
  "success": true|false,
  "message": "Response message",
  "data": { ... }
}
```

### Error Response Format
```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error information (optional)"
}
```

---

## Authentication

### 1. Register Transporter

**POST** `/api/auth/register`

Register a new transporter account.

**Access**: Public

**Request Body**:
```json
{
  "mobile": "9876543210",
  "name": "John Doe",
  "email": "john@example.com",
  "company": "ABC Transport"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "accessToken": "jwt-access-token",
    "refreshToken": "jwt-refresh-token",
    "user": {
      "id": "transporter-id",
      "mobile": "9876543210",
      "name": "John Doe",
      "email": "john@example.com",
      "company": "ABC Transport",
      "userType": "transporter",
      "status": "pending",
      "hasAccess": false,
      "hasPinSet": false
    }
  }
}
```

**Error Responses**:
- `400` - Missing required fields or invalid format
- `409` - Transporter with mobile number already exists

---

### 2. Send OTP (Mobile Login)

**POST** `/api/auth/send-otp`

Login with mobile number (simplified OTP flow - returns tokens directly).

**Access**: Public

**Request Body**:
```json
{
  "mobile": "9876543210",
  "userType": "transporter"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "jwt-access-token",
    "refreshToken": "jwt-refresh-token",
    "user": {
      "id": "transporter-id",
      "mobile": "9876543210",
      "name": "John Doe",
      "email": "john@example.com",
      "company": "ABC Transport",
      "userType": "transporter",
      "status": "active",
      "hasAccess": true,
      "hasPinSet": true
    }
  }
}
```

**Error Responses**:
- `400` - Invalid mobile number or user type
- `404` - Transporter not registered
- `403` - Account blocked

---

### 3. PIN Login

**POST** `/api/auth/pin-login`

Login using 4-digit PIN (Transporter only).

**Access**: Public

**Request Body**:
```json
{
  "mobile": "9876543210",
  "pin": "1234"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "jwt-access-token",
    "refreshToken": "jwt-refresh-token",
    "user": {
      "id": "transporter-id",
      "mobile": "9876543210",
      "name": "John Doe",
      "email": "john@example.com",
      "company": "ABC Transport",
      "userType": "transporter",
      "status": "active",
      "hasAccess": true,
      "hasPinSet": true
    }
  }
}
```

**Error Responses**:
- `400` - Invalid PIN format or PIN not set
- `401` - Invalid PIN
- `404` - Transporter not found
- `403` - Account blocked

---

### 4. Refresh Token

**POST** `/api/auth/refresh`

Refresh the access token using refresh token.

**Access**: Public

**Request Body**:
```json
{
  "refreshToken": "refresh-token-here"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "new-jwt-access-token"
  }
}
```

**Error Responses**:
- `400` - Refresh token required
- `401` - Invalid or expired refresh token

---

## Transporter Profile

### 1. Get Profile

**GET** `/api/transporters/profile`

Get authenticated transporter's profile.

**Access**: Private (Transporter only)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Profile retrieved successfully",
  "data": {
    "transporter": {
      "id": "transporter-id",
      "mobile": "9876543210",
      "name": "John Doe",
      "email": "john@example.com",
      "company": "ABC Transport",
      "status": "active",
      "hasAccess": true,
      "hasPinSet": true,
      "walletBalance": 5000.00,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

### 2. Update Profile

**PUT** `/api/transporters/profile`

Update transporter profile information.

**Access**: Private (Transporter only)

**Request Body**:
```json
{
  "name": "John Doe Updated",
  "email": "john.updated@example.com",
  "company": "ABC Transport Ltd"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "transporter": {
      "id": "transporter-id",
      "mobile": "9876543210",
      "name": "John Doe Updated",
      "email": "john.updated@example.com",
      "company": "ABC Transport Ltd",
      "status": "active",
      "hasAccess": true,
      "hasPinSet": true,
      "walletBalance": 5000.00,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T12:00:00.000Z"
    }
  }
}
```

---

### 3. Set PIN

**PUT** `/api/transporters/set-pin`

Set or update 4-digit PIN for transporter.

**Access**: Private (Transporter only)

**Request Body**:
```json
{
  "pin": "1234"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "PIN set successfully",
  "data": {
    "hasPinSet": true
  }
}
```

**Error Responses**:
- `400` - PIN must be 4 digits
- `404` - Transporter not found

---

## Vehicle Management

### 1. List Vehicles

**GET** `/api/vehicles`

Get all vehicles for authenticated transporter.

**Access**: Private (Transporter only)

**Query Parameters**:
- `status` (optional) - Filter by status: `active`, `inactive`
- `ownerType` (optional) - Filter by owner type: `OWN`, `HIRED`
- `driverId` (optional) - Filter by assigned driver ID

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "vehicles": [
      {
        "id": "vehicle-id",
        "vehicleNumber": "MH12AB1234",
        "transporterId": "transporter-id",
        "ownerType": "OWN",
        "driverId": "driver-id",
        "driver": {
          "id": "driver-id",
          "name": "Driver Name",
          "mobile": "9876543211",
          "status": "active"
        },
        "status": "active",
        "trailerType": "20ft",
        "documents": [],
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

---

### 2. Create Vehicle

**POST** `/api/vehicles`

Create a new vehicle.

**Access**: Private (Transporter only)

**Request Body**:
```json
{
  "vehicleNumber": "MH12AB1234",
  "ownerType": "OWN",
  "driverId": "driver-id",
  "trailerType": "20ft"
}
```

**Fields**:
- `vehicleNumber` (required) - Vehicle registration number
- `ownerType` (optional) - `OWN` or `HIRED` (default: `OWN`)
- `driverId` (optional) - Driver ID to assign
- `trailerType` (optional) - Trailer type (e.g., "20ft", "40ft")

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Vehicle created successfully",
  "data": {
    "vehicle": {
      "id": "vehicle-id",
      "vehicleNumber": "MH12AB1234",
      "transporterId": "transporter-id",
      "ownerType": "OWN",
      "originalOwnerId": "transporter-id",
      "driverId": "driver-id",
      "driver": {
        "id": "driver-id",
        "name": "Driver Name",
        "mobile": "9876543211",
        "status": "active"
      },
      "status": "active",
      "trailerType": "20ft",
      "documents": [],
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

**Error Responses**:
- `400` - Invalid vehicle number or owner type
- `403` - Access denied

---

### 3. Get Vehicle Details

**GET** `/api/vehicles/:id`

Get vehicle details by ID.

**Access**: Private

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "vehicle": {
      "id": "vehicle-id",
      "vehicleNumber": "MH12AB1234",
      "transporterId": "transporter-id",
      "ownerType": "OWN",
      "driverId": "driver-id",
      "driver": {
        "id": "driver-id",
        "name": "Driver Name",
        "mobile": "9876543211",
        "status": "active"
      },
      "status": "active",
      "trailerType": "20ft",
      "documents": [],
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

### 4. Update Vehicle

**PUT** `/api/vehicles/:id`

Update vehicle information.

**Access**: Private (Transporter only)

**Request Body**:
```json
{
  "driverId": "new-driver-id",
  "trailerType": "40ft",
  "status": "inactive"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Vehicle updated successfully",
  "data": {
    "vehicle": { ... }
  }
}
```

---

### 5. Delete Vehicle

**DELETE** `/api/vehicles/:id`

Delete a vehicle (only if no trip history).

**Access**: Private (Transporter only)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Vehicle deleted successfully"
}
```

**Error Responses**:
- `400` - Vehicle has trip history, cannot be deleted
- `404` - Vehicle not found

---

### 6. Get Vehicle Trip History

**GET** `/api/vehicles/:id/trips`

Get all trips for a vehicle.

**Access**: Private

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trips": [ ... ],
    "count": 10
  }
}
```

---

### 7. Check Vehicle Availability

**GET** `/api/vehicles/:id/availability`

Check vehicle availability state.

**Access**: Private

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "vehicleId": "vehicle-id",
    "status": "active",
    "hasActiveTrip": false,
    "queuedTrips": 2,
    "canCreateTrip": true,
    "message": "Vehicle is available"
  }
}
```

---

### 8. Upload Vehicle Documents

**POST** `/api/vehicles/:id/documents`

Upload vehicle documents (RC, Insurance, Fitness, Permit).

**Access**: Private (Transporter only)

**Content-Type**: `multipart/form-data`

**Form Data**:
- `documentType` (required) - `RC`, `INSURANCE`, `FITNESS`, `PERMIT`
- `file` (required) - Document file
- `expiryDate` (optional) - Document expiry date (ISO format)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Document uploaded successfully",
  "data": {
    "document": {
      "type": "RC",
      "url": "/uploads/vehicles/rc_vehicle-id_timestamp.pdf",
      "expiryDate": "2025-12-31T00:00:00.000Z",
      "uploadedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

### 9. Get Vehicle Documents

**GET** `/api/vehicles/:id/documents`

Get all documents for a vehicle.

**Access**: Private

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "type": "RC",
        "url": "/uploads/vehicles/rc_vehicle-id_timestamp.pdf",
        "expiryDate": "2025-12-31T00:00:00.000Z",
        "uploadedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

## Driver Management

### 1. Get Drivers by Transporter

**GET** `/api/drivers/transporter/:transporterId`

Get all drivers for a transporter.

**Access**: Private (Transporter only)

**Note**: The `transporterId` in the URL must match the authenticated transporter's ID.

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Drivers retrieved successfully",
  "data": {
    "drivers": [
      {
        "id": "driver-id",
        "mobile": "9876543211",
        "name": "Driver Name",
        "status": "active",
        "riskLevel": "low",
        "language": "en",
        "walletBalance": 1000.00,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

**Note**: Drivers are auto-created when they first login via OTP. Transporters cannot manually create drivers through the API.

---

## Trip Management

### 1. List Trips

**GET** `/api/trips`

Get all trips for authenticated transporter.

**Access**: Private (Transporter only)

**Query Parameters**:
- `status` (optional) - Filter by status: `PLANNED`, `ACTIVE`, `COMPLETED`, `POD_PENDING`, `CANCELLED`
- `vehicleId` (optional) - Filter by vehicle ID
- `driverId` (optional) - Filter by driver ID
- `tripType` (optional) - Filter by trip type: `IMPORT`, `EXPORT`
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)
- `startDate` (optional) - Filter trips from date (ISO format)
- `endDate` (optional) - Filter trips to date (ISO format)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trips": [
      {
        "tripId": "TRIP-2024-001",
        "id": "trip-id",
        "transporterId": "transporter-id",
        "vehicleId": {
          "id": "vehicle-id",
          "vehicleNumber": "MH12AB1234",
          "trailerType": "20ft"
        },
        "driverId": {
          "id": "driver-id",
          "name": "Driver Name",
          "mobile": "9876543211"
        },
        "containerNumber": "CONTAINER123",
        "reference": "REF-001",
        "pickupLocation": {
          "address": "Pickup Address",
          "coordinates": {
            "latitude": 19.0760,
            "longitude": 72.8777
          }
        },
        "dropLocation": {
          "address": "Drop Address",
          "coordinates": {
            "latitude": 18.5204,
            "longitude": 73.8567
          }
        },
        "tripType": "IMPORT",
        "status": "ACTIVE",
        "milestones": [],
        "POD": null,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "pages": 3
    }
  }
}
```

---

### 2. Create Trip

**POST** `/api/trips`

Create a new trip.

**Access**: Private (Transporter only)

**Request Body**:
```json
{
  "vehicleId": "vehicle-id",
  "driverId": "driver-id",
  "containerNumber": "CONTAINER123",
  "reference": "REF-001",
  "pickupLocation": {
    "address": "Pickup Address",
    "coordinates": {
      "latitude": 19.0760,
      "longitude": 72.8777
    }
  },
  "dropLocation": {
    "address": "Drop Address",
    "coordinates": {
      "latitude": 18.5204,
      "longitude": 73.8567
    }
  },
  "tripType": "IMPORT"
}
```

**Fields**:
- `vehicleId` (required) - Vehicle ID
- `driverId` (optional) - Driver ID to assign
- `containerNumber` (optional) - Container number
- `reference` (optional) - Reference number
- `pickupLocation` (optional) - Pickup location with coordinates
- `dropLocation` (optional) - Drop location with coordinates
- `tripType` (required) - `IMPORT` or `EXPORT`

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Trip created successfully",
  "data": {
    "tripId": "TRIP-2024-001",
    "id": "trip-id",
    "transporterId": "transporter-id",
    "vehicleId": { ... },
    "driverId": { ... },
    "containerNumber": "CONTAINER123",
    "reference": "REF-001",
    "pickupLocation": { ... },
    "dropLocation": { ... },
    "tripType": "IMPORT",
    "status": "PLANNED",
    "milestones": [],
    "POD": null,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### 3. Get Trip Details

**GET** `/api/trips/:id`

Get trip details by ID.

**Access**: Private

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trip": {
      "tripId": "TRIP-2024-001",
      "id": "trip-id",
      "transporterId": { ... },
      "vehicleId": { ... },
      "driverId": { ... },
      "containerNumber": "CONTAINER123",
      "reference": "REF-001",
      "pickupLocation": { ... },
      "dropLocation": { ... },
      "tripType": "IMPORT",
      "status": "ACTIVE",
      "milestones": [ ... ],
      "POD": { ... },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

### 4. Update Trip

**PUT** `/api/trips/:id`

Update trip information (vehicle/driver change allowed before start).

**Access**: Private (Transporter only)

**Request Body**:
```json
{
  "vehicleId": "new-vehicle-id",
  "driverId": "new-driver-id",
  "containerNumber": "CONTAINER456",
  "reference": "REF-002"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Trip updated successfully",
  "data": {
    "trip": { ... }
  }
}
```

---

### 5. Cancel Trip

**PUT** `/api/trips/:id/cancel`

Cancel a trip.

**Access**: Private (Transporter only)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Trip cancelled successfully",
  "data": {
    "trip": { ... }
  }
}
```

---

### 6. Search Trips

**GET** `/api/trips/search`

Search trips by container number or reference.

**Access**: Private (Transporter only)

**Query Parameters**:
- `q` (required) - Search query (container number or reference)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trips": [ ... ],
    "count": 5
  }
}
```

---

### 7. Get Trips by Status

**GET** `/api/trips/status/:status`

Get trips filtered by status.

**Access**: Private (Transporter only)

**Path Parameters**:
- `status` - Trip status: `PLANNED`, `ACTIVE`, `COMPLETED`, `POD_PENDING`, `CANCELLED`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trips": [ ... ],
    "count": 10
  }
}
```

---

### 8. Start Trip

**PUT** `/api/trips/:id/start`

Start a trip (changes status from PLANNED to ACTIVE).

**Access**: Private (Transporter only)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Trip started successfully",
  "data": {
    "trip": { ... }
  }
}
```

---

### 9. Complete Trip

**PUT** `/api/trips/:id/complete`

Mark trip as completed.

**Access**: Private (Transporter only)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Trip completed successfully",
  "data": {
    "trip": { ... }
  }
}
```

---

### 10. Update Milestone

**POST** `/api/trips/:id/milestones/:milestoneNumber`

Update trip milestone (Driver only).

**Access**: Private (Driver only)

**Content-Type**: `multipart/form-data`

**Path Parameters**:
- `id` - Trip ID
- `milestoneNumber` - Milestone number (1-5)

**Form Data**:
- `latitude` (required) - GPS latitude
- `longitude` (required) - GPS longitude
- `photo` (optional) - Milestone photo file
- `address` (optional) - Address string

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Milestone updated successfully",
  "data": {
    "trip": { ... },
    "milestone": {
      "number": 1,
      "type": "PICKUP",
      "completedAt": "2024-01-01T00:00:00.000Z",
      "location": {
        "latitude": 19.0760,
        "longitude": 72.8777,
        "address": "Location Address"
      },
      "photo": "/uploads/milestones/milestone_trip-id_1_timestamp.jpg"
    }
  }
}
```

**Note**: Milestones must be completed in order (1, 2, 3, 4, 5).

---

### 11. Get Current Milestone

**GET** `/api/trips/:id/current-milestone`

Get current milestone information for a trip.

**Access**: Private

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "currentMilestone": {
      "number": 2,
      "type": "IN_TRANSIT",
      "label": "In Transit",
      "completed": false
    },
    "completedMilestones": 1,
    "totalMilestones": 5
  }
}
```

---

### 12. Get Trip Timeline

**GET** `/api/trips/:id/timeline`

Get complete trip timeline with all milestones.

**Access**: Private

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "timeline": [
      {
        "milestone": {
          "number": 1,
          "type": "PICKUP",
          "label": "Pickup",
          "completed": true,
          "completedAt": "2024-01-01T00:00:00.000Z",
          "location": { ... },
          "photo": "/uploads/milestones/..."
        }
      },
      {
        "milestone": {
          "number": 2,
          "type": "IN_TRANSIT",
          "label": "In Transit",
          "completed": false
        }
      }
    ]
  }
}
```

---

### 13. Upload POD (Proof of Delivery)

**POST** `/api/trips/:id/pod`

Upload Proof of Delivery document.

**Access**: Private (Driver or Transporter)

**Content-Type**: `multipart/form-data`

**Form Data**:
- `file` (required) - POD photo file

**Response** (200 OK):
```json
{
  "success": true,
  "message": "POD uploaded successfully",
  "data": {
    "trip": { ... },
    "POD": {
      "photo": "/uploads/pod/pod_trip-id_timestamp.jpg",
      "uploadedAt": "2024-01-01T00:00:00.000Z",
      "uploadedBy": "driver-id",
      "approvedAt": null,
      "approvedBy": null
    }
  }
}
```

**Note**: POD can only be uploaded for COMPLETED trips.

---

### 14. Approve POD

**PUT** `/api/trips/:id/pod/approve`

Approve POD (Transporter only).

**Access**: Private (Transporter only)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "POD approved successfully",
  "data": {
    "trip": { ... },
    "POD": {
      "photo": "/uploads/pod/pod_trip-id_timestamp.jpg",
      "uploadedAt": "2024-01-01T00:00:00.000Z",
      "uploadedBy": "driver-id",
      "approvedAt": "2024-01-01T12:00:00.000Z",
      "approvedBy": "transporter-id"
    }
  }
}
```

---

### 15. Share Trip

**POST** `/api/trips/:id/share`

Generate a shareable link for a trip.

**Access**: Private (Transporter only)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Share link generated successfully",
  "data": {
    "shareToken": "unique-share-token",
    "shareUrl": "http://localhost:3000/api/trips/shared/unique-share-token",
    "expiresAt": "2024-01-02T00:00:00.000Z"
  }
}
```

---

### 16. Get Shared Trip

**GET** `/api/trips/shared/:token`

Get trip details via share token (Public access).

**Access**: Public (No authentication required)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "trip": { ... }
  }
}
```

---

## Fuel Management

### 1. List Fuel Cards

**GET** `/api/fuel-cards`

Get all fuel cards for authenticated transporter.

**Access**: Private (Transporter only)

**Query Parameters**:
- `status` (optional) - Filter by status: `active`, `inactive`, `blocked`
- `assigned` (optional) - Filter by assignment: `true`, `false`

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "fuel-card-id",
      "cardNumber": "FC1234567890",
      "transporterId": "transporter-id",
      "transporter": {
        "id": "transporter-id",
        "name": "Transporter Name",
        "company": "Company Name"
      },
      "driverId": "driver-id",
      "driver": {
        "id": "driver-id",
        "name": "Driver Name",
        "mobile": "9876543211"
      },
      "balance": 5000.00,
      "status": "active",
      "assignedBy": "transporter-id",
      "assignedAt": "2024-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 2. Get Assigned Fuel Cards

**GET** `/api/fuel-cards/assigned`

Get fuel cards assigned to drivers.

**Access**: Private (Transporter only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "fuel-card-id",
      "cardNumber": "FC1234567890",
      "driverId": "driver-id",
      "driver": { ... },
      "balance": 5000.00,
      "status": "active"
    }
  ]
}
```

---

### 3. Get Fuel Card Transactions

**GET** `/api/fuel-cards/:id/transactions`

Get all transactions for a fuel card.

**Access**: Private (Transporter only)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "transactionId": "FTX-2024-001",
        "id": "transaction-id",
        "pumpOwnerId": "pump-owner-id",
        "vehicleNumber": "MH12AB1234",
        "driverId": "driver-id",
        "fuelCardId": "fuel-card-id",
        "amount": 2000.00,
        "status": "completed",
        "location": {
          "latitude": 19.0760,
          "longitude": 72.8777,
          "address": "Fuel Station Address"
        },
        "receipt": {
          "photo": "/uploads/receipts/receipt_transaction-id_timestamp.jpg",
          "uploadedAt": "2024-01-01T00:00:00.000Z"
        },
        "fraudFlags": [],
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "count": 10
  }
}
```

---

### 4. Generate QR Code for Fuel Transaction

**POST** `/api/fuel/generate-qr`

Generate QR code for fuel transaction (Driver only).

**Access**: Private (Driver only)

**Request Body**:
```json
{
  "vehicleNumber": "MH12AB1234",
  "amount": 2000.00,
  "latitude": 19.0760,
  "longitude": 72.8777,
  "accuracy": 10.5,
  "address": "Fuel Station Address"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "QR code generated successfully",
  "data": {
    "transactionId": "FTX-2024-001",
    "qrCode": "encrypted-qr-code-string",
    "expiresAt": "2024-01-01T01:00:00.000Z",
    "amount": 2000.00,
    "vehicleNumber": "MH12AB1234"
  }
}
```

---

### 5. Scan QR Code

**POST** `/api/fuel/scan-qr`

Scan and validate QR code (Pump Staff only).

**Access**: Private (Pump Staff only)

**Request Body**:
```json
{
  "qrCode": "encrypted-qr-code-string",
  "latitude": 19.0760,
  "longitude": 72.8777
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "QR code validated successfully",
  "data": {
    "transactionId": "FTX-2024-001",
    "amount": 2000.00,
    "vehicleNumber": "MH12AB1234",
    "driverId": "driver-id",
    "fuelCardId": "fuel-card-id",
    "cardBalance": 5000.00,
    "canProceed": true
  }
}
```

---

### 6. List Fuel Transactions

**GET** `/api/fuel/transactions`

Get all fuel transactions for authenticated transporter.

**Access**: Private (Transporter only)

**Query Parameters**:
- `status` (optional) - Filter by status: `pending`, `completed`, `cancelled`
- `fuelCardId` (optional) - Filter by fuel card ID
- `driverId` (optional) - Filter by driver ID
- `startDate` (optional) - Filter from date
- `endDate` (optional) - Filter to date

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "transactions": [ ... ],
    "count": 20
  }
}
```

---

## Error Handling

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid token)
- `403` - Forbidden (access denied)
- `404` - Not Found
- `409` - Conflict (duplicate entry)
- `500` - Internal Server Error

### Error Response Format

```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error information (optional)"
}
```

### Common Error Messages

- `"Mobile number is required"` - Missing mobile number
- `"Invalid mobile number format. Must be 10 digits"` - Invalid mobile format
- `"Transporter not found"` - Transporter doesn't exist
- `"Access denied"` - User doesn't have permission
- `"Invalid PIN"` - PIN verification failed
- `"Vehicle not found"` - Vehicle doesn't exist
- `"Trip not found"` - Trip doesn't exist

---

## Socket.IO Events

The API uses Socket.IO for real-time updates. Connect to the server and join the transporter room to receive updates.

### Connection

```javascript
const socket = io('http://localhost:3000');
socket.emit('join-transporter-room', transporterId);
```

### Events

#### `trip:created`
Emitted when a new trip is created.

```json
{
  "trip": { ... }
}
```

#### `trip:updated`
Emitted when a trip is updated.

```json
{
  "trip": { ... }
}
```

#### `trip:status-changed`
Emitted when trip status changes.

```json
{
  "tripId": "trip-id",
  "status": "ACTIVE"
}
```

#### `milestone:updated`
Emitted when a milestone is updated.

```json
{
  "tripId": "trip-id",
  "milestone": { ... }
}
```

---

## File Uploads

### Supported File Types

- Images: `jpg`, `jpeg`, `png`
- Documents: `pdf`

### Upload Endpoints

1. **Vehicle Documents**: `POST /api/vehicles/:id/documents`
2. **Trip Milestone Photos**: `POST /api/trips/:id/milestones/:milestoneNumber`
3. **POD Upload**: `POST /api/trips/:id/pod`
4. **Fuel Receipt**: `POST /api/fuel/transactions/:id/receipt`

### Upload Format

All file uploads use `multipart/form-data` content type.

### File Access

Uploaded files are accessible via:
```
http://localhost:3000/uploads/{directory}/{filename}
```

---

## Notes

1. **Authentication**: Most endpoints require authentication. Include the JWT token in the Authorization header.

2. **Status Values**:
   - Transporter status: `active`, `inactive`, `blocked`, `pending`
   - Trip status: `PLANNED`, `ACTIVE`, `COMPLETED`, `POD_PENDING`, `CANCELLED`
   - Vehicle status: `active`, `inactive`
   - Fuel Card status: `active`, `inactive`, `blocked`

3. **Driver Creation**: Drivers are auto-created when they first login via OTP. Transporters cannot manually create drivers.

4. **Vehicle Ownership**: 
   - `OWN`: Vehicle owned by transporter
   - `HIRED`: Vehicle hired from another transporter

5. **Trip Milestones**: Must be completed in sequential order (1, 2, 3, 4, 5).

6. **POD Upload**: Can only be uploaded for COMPLETED trips.

7. **Real-time Updates**: Use Socket.IO for real-time trip and milestone updates.

---

## Support

For API support or questions, please contact the development team.
