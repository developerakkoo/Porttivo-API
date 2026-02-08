# Porttivo API

Backend API for Porttivo platform - Phase 1: Authentication (Transporter & Driver)

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

Update the following in `.env`:
- `MONGODB_URI`: Your MongoDB connection string
- `JWT_SECRET`: A strong secret key for JWT signing

### 3. Start MongoDB

Make sure MongoDB is running on your system:

```bash
# If using local MongoDB
mongod
```

Or use MongoDB Atlas connection string in `.env`

### 4. Run the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

Server will start on `http://localhost:3000`

## API Endpoints

### Authentication

#### 1. Send OTP (Mobile Login)
**POST** `/api/auth/send-otp`

Request Body:
```json
{
  "mobile": "9876543210",
  "userType": "transporter" | "driver"
}
```

Response:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "jwt-token",
    "refreshToken": "refresh-token",
    "user": {
      "id": "user-id",
      "mobile": "9876543210",
      "name": "User Name",
      "userType": "transporter" | "driver",
      "status": "active" | "pending",
      "hasAccess": true
    }
  }
}
```

#### 2. PIN Login (Transporter Only)
**POST** `/api/auth/pin-login`

Request Body:
```json
{
  "mobile": "9876543210",
  "pin": "1234"
}
```

#### 3. Refresh Token
**POST** `/api/auth/refresh`

Request Body:
```json
{
  "refreshToken": "refresh-token-here"
}
```

### Health Check

**GET** `/health`

Returns server status and timestamp.

## Testing

### Using cURL

**Test Transporter Login:**
```bash
curl -X POST http://localhost:3000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"mobile":"9876543210","userType":"transporter"}'
```

**Test Driver Login:**
```bash
curl -X POST http://localhost:3000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"mobile":"9876543210","userType":"driver"}'
```

**Test PIN Login:**
```bash
curl -X POST http://localhost:3000/api/auth/pin-login \
  -H "Content-Type: application/json" \
  -d '{"mobile":"9876543210","pin":"1234"}'
```

## Notes

- **No OTP Service**: Currently, the `/api/auth/send-otp` endpoint returns tokens directly without actual OTP verification. This will be integrated later.
- **Auto-create Drivers**: New drivers are automatically created with `status: 'pending'` when they login for the first time.
- **Transporter Registration**: Transporters must be pre-registered. They cannot be auto-created on login.

## Project Structure

```
Porttivo-API/
├── src/
│   ├── config/          # Configuration files
│   ├── models/          # Mongoose models
│   ├── controllers/     # Route controllers
│   ├── routes/          # API routes
│   ├── middleware/      # Express middleware
│   ├── services/        # Business logic services
│   └── utils/           # Utility functions
├── index.js              # Entry point
└── package.json
```

## Next Steps

1. Integrate actual OTP service (Twilio/AWS SNS)
2. Add PIN setup/change endpoints
3. Add forgot PIN functionality
4. Add user profile endpoints
# Porttivo-API
# Porttivo-API
