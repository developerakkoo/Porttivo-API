const Trip = require('../models/Trip')
const path = require('path')
const { TRIP_STATUS, calculatePodDueAt } = require('../utils/tripState')
const {
  emitTripPodUploaded,
  emitTripClosedWithPOD,
  emitTripAutoActivated,
  emitTripMilestoneUpdated,
  emitTripPodPending,
  emitTripCompleted
} = require('../services/socket.service')
const { activateNextTrip } = require('../services/tripQueue.service')
const {
  autoCloseTripIfExpired,
  toAuditUserType
} = require('../services/tripLifecycle.service')
const {
  getBackendMeaning,
  getMilestoneTypeByNumber
} = require('../utils/milestoneMapping')
const { sendTripCompletedTemplate } = require('../services/wati.service')

const triggerWatiTemplate = async (handler, contextLabel) => {
  try {
    await handler()
  } catch (error) {
    console.error(`WATI ${contextLabel} failed:`, error.message)
  }
}

const getVehicleRoom = trip => {
  if (trip.vehicleId) {
    return `vehicle:${trip.vehicleId}`
  }

  if (trip.hiredVehicle?.vehicleNumber) {
    return `vehicle:hired:${trip.hiredVehicle.vehicleNumber}`
  }

  return null
}

/**
 * Upload POD
 * POST /api/trips/:id/pod
 */
const uploadPOD = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user.id
    const userType = req.user.userType

    // Find trip
    const trip = await Trip.findById(id)
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    // POD upload is driver-only.
    if (userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers can upload POD.'
      })
    }

    const { autoClosed } = await autoCloseTripIfExpired(trip, {
      userId,
      userType
    })
    if (autoClosed) {
      return res.status(400).json({
        success: false,
        message:
          'POD upload window has expired. The trip was auto-closed without POD.',
        data: trip
      })
    }

    if (!trip.driverId || trip.driverId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This trip is not assigned to you.'
      })
    }

    // Validate trip status - POD can be uploaded when ACTIVE (4 milestones) or POD_PENDING
    const isActiveWithFourMilestones =
      trip.status === TRIP_STATUS.ACTIVE && trip.milestones?.length === 4
    if (
      trip.status !== TRIP_STATUS.POD_PENDING &&
      !isActiveWithFourMilestones
    ) {
      return res.status(400).json({
        success: false,
        message: `POD can only be uploaded when trip is ACTIVE with 4 milestones or POD_PENDING. Current status: ${
          trip.status
        }, milestones: ${trip.milestones?.length || 0}`
      })
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'POD photo is required'
      })
    }

    // Get photo URL
    const photoUrl = `/uploads/pod/${req.file.filename}`

    const wasActiveWithFourMilestones = isActiveWithFourMilestones

    if (wasActiveWithFourMilestones) {
      // Milestone 5 = POD upload: add milestone 5 (TRIP_COMPLETED), set POD, move to POD_PENDING
      const milestoneType = getMilestoneTypeByNumber(5)
      const milestone = {
        milestoneType,
        milestoneNumber: 5,
        timestamp: new Date(),
        location: trip.milestones[3]?.location || { latitude: 0, longitude: 0 },
        photo: null,
        driverId: userId,
        backendMeaning: getBackendMeaning(milestoneType, trip.tripType)
      }
      trip.milestones.push(milestone)
      trip.completedAt = new Date()
      trip.podDueAt = calculatePodDueAt(trip.completedAt)
      trip.podTimerStartedAt = trip.completedAt
    }

    // Update trip POD
    trip.POD = {
      photo: photoUrl,
      uploadedAt: new Date(),
      uploadedBy: userId,
      approvedAt: null,
      approvedBy: null
    }

    if (wasActiveWithFourMilestones) {
      trip.status = TRIP_STATUS.POD_PENDING
    }

    trip.audit.updatedBy = {
      userId,
      userType: toAuditUserType(userType)
    }

    await trip.save()

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType')
    await trip.populate('driverId', 'name mobile')
    await trip.populate('transporterId', 'name company')
    await trip.populate('customerId', 'name mobile')

    if (wasActiveWithFourMilestones) {
      const milestone = trip.milestones[trip.milestones.length - 1]
      emitTripMilestoneUpdated(trip, milestone, null)
      emitTripPodUploaded(trip)
      emitTripPodPending(trip)
      emitTripCompleted(trip)

      if (trip.customerId) {
        await triggerWatiTemplate(
          () =>
            sendTripCompletedTemplate({
              recipient: trip.customerId,
              trip,
              recipientKey: 'customer'
            }),
          'trip completed template for customer'
        )
      }
      if (trip.transporterId) {
        await triggerWatiTemplate(
          () =>
            sendTripCompletedTemplate({
              recipient: trip.transporterId,
              trip,
              recipientKey: 'transporter'
            }),
          'trip completed template for transporter'
        )
      }

      try {
        const nextTrip = await activateNextTrip(trip)
        if (nextTrip) {
          emitTripAutoActivated(nextTrip)
        }
      } catch (queueError) {
        console.error(
          'Error in auto-queue after POD upload (milestone 5):',
          queueError
        )
      }
    } else {
      emitTripPodUploaded(trip)
    }

    const tripData = trip.toObject ? trip.toObject() : trip
    res.json({
      success: true,
      message: wasActiveWithFourMilestones
        ? 'POD uploaded successfully. Trip completed and POD is now pending approval.'
        : 'POD uploaded successfully',
      data: tripData
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Approve POD
 * PUT /api/trips/:id/pod/approve
 */
const approvePOD = async (req, res, next) => {
  try {
    // Only transporters can approve POD
    if (req.user.userType !== 'transporter') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters can approve POD.'
      })
    }

    const { id } = req.params
    const transporterId = req.user.id

    // Find trip
    const trip = await Trip.findById(id)
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    const { autoClosed } = await autoCloseTripIfExpired(trip, {
      userId: transporterId,
      userType: req.user.userType
    })
    if (autoClosed) {
      return res.status(400).json({
        success: false,
        message:
          'POD approval window has expired. The trip was auto-closed without POD.',
        data: trip
      })
    }

    // Check access
    if (trip.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You do not have permission to approve POD for this trip.'
      })
    }

    // Validate trip status
    if (trip.status !== TRIP_STATUS.POD_PENDING) {
      return res.status(400).json({
        success: false,
        message: `POD can only be approved when status is POD_PENDING. Current status: ${trip.status}`
      })
    }

    // Check if POD exists
    if (!trip.POD || !trip.POD.photo) {
      return res.status(400).json({
        success: false,
        message: 'POD has not been uploaded yet'
      })
    }

    // Update POD approval
    trip.POD.approvedAt = new Date()
    trip.POD.approvedBy = transporterId

    // Update trip status to final closed state
    trip.status = TRIP_STATUS.CLOSED_WITH_POD
    trip.closedAt = new Date()
    trip.closedReason = 'POD_APPROVED'
    trip.audit.updatedBy = {
      userId: transporterId,
      userType: toAuditUserType(req.user.userType)
    }
    await trip.save()

    if (trip.bookingId) {
      await VehicleBooking.findByIdAndUpdate(trip.bookingId, {
        status: 'COMPLETED',
        completedAt: new Date()
      })
    }

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType')
    await trip.populate('driverId', 'name mobile')
    await trip.populate('transporterId', 'name company')
    await trip.populate('customerId', 'name mobile')

    emitTripClosedWithPOD(trip)

    try {
      const nextTrip = await activateNextTrip(trip)
      if (nextTrip) {
        emitTripAutoActivated(nextTrip)
      }
    } catch (queueError) {
      console.error('Error in auto-queue after POD approval:', queueError)
    }

    const tripData = trip.toObject ? trip.toObject() : trip
    res.json({
      success: true,
      message: 'POD approved successfully',
      data: tripData
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  uploadPOD,
  approvePOD
}
