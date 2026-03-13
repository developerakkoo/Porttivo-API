const http = require('http');
const https = require('https');
const {
  watiApiEndpoint,
  watiBearerToken,
  watiDefaultCountryCode,
  watiBroadcastPrefix,
} = require('../config/env');

const WATI_API_ENDPOINT = watiApiEndpoint || '';
const WATI_BEARER_TOKEN = watiBearerToken || '';
const WATI_DEFAULT_COUNTRY_CODE = (watiDefaultCountryCode || '91').replace(/\D/g, '');
const WATI_BROADCAST_PREFIX = watiBroadcastPrefix || 'porttivo';

const isWatiConfigured = () => Boolean(WATI_API_ENDPOINT && WATI_BEARER_TOKEN);
const getAuthorizationHeader = () =>
  WATI_BEARER_TOKEN.toLowerCase().startsWith('bearer ') ? WATI_BEARER_TOKEN : `Bearer ${WATI_BEARER_TOKEN}`;

const normalizeWhatsappNumber = (mobile) => {
  if (!mobile) {
    return null;
  }

  const digits = String(mobile).replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  if (digits.length === 10) {
    return `${WATI_DEFAULT_COUNTRY_CODE}${digits}`;
  }

  return digits;
};

const formatLocation = (location) => {
  if (!location) {
    return 'N/A';
  }

  const parts = [location.address, location.city, location.state, location.pincode]
    .map((value) => value?.trim())
    .filter(Boolean);

  return parts.length ? parts.join(', ') : 'N/A';
};

const formatTripDate = (date) => {
  if (!date) {
    return 'N/A';
  }

  return new Date(date).toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
};

const buildBroadcastName = (templateName, referenceId) => {
  const safeTemplateName = templateName.replace(/[^a-zA-Z0-9_]/g, '_');
  const safeReferenceId = String(referenceId || Date.now()).replace(/[^a-zA-Z0-9_]/g, '_');

  return `${WATI_BROADCAST_PREFIX}_${safeTemplateName}_${safeReferenceId}`.slice(0, 80);
};

const sendTemplateMessage = ({ whatsappNumber, templateName, parameters = [], broadcastName }) =>
  new Promise((resolve, reject) => {
    if (!isWatiConfigured()) {
      console.warn('WATI send skipped: configuration is missing');
      return resolve({
        skipped: true,
        reason: 'WATI is not configured',
      });
    }

    if (!whatsappNumber) {
      console.warn('WATI send skipped: WhatsApp number is missing');
      return resolve({
        skipped: true,
        reason: 'Missing WhatsApp number',
      });
    }

    const endpoint = new URL(WATI_API_ENDPOINT);
    const client = endpoint.protocol === 'http:' ? http : https;
    const basePath = endpoint.pathname && endpoint.pathname !== '/' ? endpoint.pathname.replace(/\/$/, '') : '';
    const formattedParameters = parameters.map((parameter, index) => {
      if (parameter && typeof parameter === 'object' && parameter.name && parameter.value !== undefined) {
        return parameter;
      }

      return {
        name: String(index + 1),
        value: parameter ?? '',
      };
    });
    const requestBody = JSON.stringify({
      template_name: templateName,
      broadcast_name: broadcastName || buildBroadcastName(templateName, whatsappNumber),
      parameters: formattedParameters,
    });

    const request = client.request(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port || undefined,
        path: `${basePath}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(whatsappNumber)}`,
        method: 'POST',
        headers: {
          Authorization: getAuthorizationHeader(),
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      (response) => {
        let rawData = '';

        response.on('data', (chunk) => {
          rawData += chunk;
        });

        response.on('end', () => {
          let parsed;
          try {
            parsed = rawData ? JSON.parse(rawData) : null;
          } catch (error) {
            parsed = rawData;
          }

          if (response.statusCode >= 200 && response.statusCode < 300) {
            console.log(`WATI template sent successfully: ${templateName} -> ${whatsappNumber}`);
            return resolve(parsed);
          }

          return reject(
            new Error(
              `WATI request failed with status ${response.statusCode}: ${
                typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
              }`
            )
          );
        });
      }
    );

    request.on('error', reject);
    request.write(requestBody);
    request.end();
  });

const sendTripCreatedConfirmation = async ({ customer, trip }) => {
  const whatsappNumber = normalizeWhatsappNumber(customer?.mobile || trip?.customerMobile);

  return sendTemplateMessage({
    whatsappNumber,
    templateName: 'porttivo_trip_created_confirmation',
    broadcastName: buildBroadcastName('trip_created', trip?.tripId),
    parameters: [
      customer?.name || trip?.customerName || 'Customer',
      formatLocation(trip?.pickupLocation),
      formatLocation(trip?.dropLocation),
    ],
  });
};

const sendBookingAcceptedTemplate = async ({ customer, trip }) => {
  const whatsappNumber = normalizeWhatsappNumber(customer?.mobile || trip?.customerMobile);

  return sendTemplateMessage({
    whatsappNumber,
    templateName: 'booking_accepted',
    broadcastName: buildBroadcastName('booking_accepted', trip?.tripId),
    parameters: [
      formatLocation(trip?.pickupLocation),
      trip?.loadType?.trim() || 'N/A',
      formatLocation(trip?.dropLocation),
      formatTripDate(trip?.scheduledAt),
    ],
  });
};

const sendDriverVehicleAssignedTemplate = async ({ customer, trip }) => {
  const whatsappNumber = normalizeWhatsappNumber(customer?.mobile || trip?.customerMobile);

  return sendTemplateMessage({
    whatsappNumber,
    templateName: 'driver_vehicle_assigned',
    broadcastName: buildBroadcastName('driver_vehicle_assigned', trip?.tripId),
    parameters: [
      customer?.name || trip?.customerName || 'Customer',
      formatLocation(trip?.pickupLocation),
      trip?.loadType?.trim() || 'N/A',
      formatTripDate(trip?.scheduledAt),
      trip?.driverId?.mobile || 'N/A',
      trip?.vehicleId?.vehicleNumber || 'N/A',
    ],
  });
};

const sendBookingRejectedTemplate = async ({ customer, trip }) => {
  const whatsappNumber = normalizeWhatsappNumber(customer?.mobile || trip?.customerMobile);

  return sendTemplateMessage({
    whatsappNumber,
    templateName: 'booking_rejected',
    broadcastName: buildBroadcastName('booking_rejected', trip?.tripId),
    parameters: [formatLocation(trip?.pickupLocation), trip?.loadType?.trim() || 'N/A', formatTripDate(trip?.scheduledAt)],
  });
};

const sendVehicleReachedPickupTemplate = async ({ customer, trip }) => {
  const whatsappNumber = normalizeWhatsappNumber(customer?.mobile || trip?.customerMobile);

  return sendTemplateMessage({
    whatsappNumber,
    templateName: 'vehicle_reached_pickup',
    broadcastName: buildBroadcastName('vehicle_reached_pickup', trip?.tripId),
    parameters: [trip?.vehicleId?.vehicleNumber || 'N/A', trip?.driverId?.mobile || 'N/A'],
  });
};

const sendBookingRequestReceivedTemplate = async ({ transporter, trip }) => {
  const whatsappNumber = normalizeWhatsappNumber(transporter?.mobile);

  return sendTemplateMessage({
    whatsappNumber,
    templateName: 'booking_request_received',
    broadcastName: buildBroadcastName('booking_request_received', `${trip?.tripId}_${transporter?._id}`),
    parameters: [
      formatLocation(trip?.pickupLocation),
      trip?.loadType?.trim() || 'N/A',
      formatLocation(trip?.dropLocation),
      formatTripDate(trip?.scheduledAt),
    ],
  });
};

const sendContainerPickedTemplate = async ({ customer, trip }) => {
  const whatsappNumber = normalizeWhatsappNumber(customer?.mobile || trip?.customerMobile);

  return sendTemplateMessage({
    whatsappNumber,
    templateName: 'container_picked',
    broadcastName: buildBroadcastName('container_picked', trip?.tripId),
    parameters: [trip?.vehicleId?.vehicleNumber || 'N/A', trip?.driverId?.mobile || 'N/A'],
  });
};

const sendTripCompletedTemplate = async ({ recipient, trip, recipientKey }) => {
  const whatsappNumber = normalizeWhatsappNumber(recipient?.mobile || trip?.customerMobile);

  return sendTemplateMessage({
    whatsappNumber,
    templateName: 'trip_completed',
    broadcastName: buildBroadcastName('trip_completed', `${trip?.tripId}_${recipientKey || 'recipient'}`),
    parameters: [trip?.vehicleId?.vehicleNumber || 'N/A', trip?.driverId?.mobile || 'N/A'],
  });
};

module.exports = {
  sendTemplateMessage,
  sendTripCreatedConfirmation,
  sendBookingAcceptedTemplate,
  sendDriverVehicleAssignedTemplate,
  sendBookingRejectedTemplate,
  sendVehicleReachedPickupTemplate,
  sendBookingRequestReceivedTemplate,
  sendContainerPickedTemplate,
  sendTripCompletedTemplate,
};
