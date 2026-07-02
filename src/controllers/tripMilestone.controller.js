const Trip = require('../models/Trip')
const { canTransporterPartyViewTripExecution } = require('../services/tripAccess.service')
const { fetchMarketplacePaymentSnapshotByTrip } = require('../services/marketplacePayment.service')
const {
  getBackendMeaning,
  getDriverLabel,
  getMilestoneTypeByNumber
} = require('../utils/milestoneMapping')
const {
  emitTripMilestoneUpdated,
  emitMarketplacePaymentReady
} = require('../services/socket.service')
const {
  sendVehicleReachedPickupTemplate,
  sendContainerPickedTemplate
} = require('../services/wati.service')
const path = require('path')
const { TRIP_STATUS } = require('../utils/tripState')
const { ensureMilestonePhoto, toAuditUserType } = require('../services/tripLifecycle.service')
const {
  TRACKABLE_STATUSES,
  getLocationTrailForTrip
} = require('../services/tripLocationTrail.service')

const getVehicleRoom = trip => {
  if (trip.vehicleId) {
    return `vehicle:${trip.vehicleId}`
  }

  if (trip.hiredVehicle?.vehicleNumber) {
    return `vehicle:hired:${trip.hiredVehicle.vehicleNumber}`
  }

  return null
}

const triggerWatiTemplate = async (handler, contextLabel) => {
  try {
    await handler()
  } catch (error) {
    console.error(`WATI ${contextLabel} failed:`, error.message)
  }
}

/**
 * Update milestone
 * POST /api/trips/:id/milestones/:milestoneNumber
 */
const updateMilestone = async (req, res, next) => {
  try {
    const { id, milestoneNumber } = req.params
    const userId = req.user.id
    const userType = req.user.userType

    // Only drivers can update milestones
    if (userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers can update milestones.'
      })
    }

    const milestoneNum = parseInt(milestoneNumber)
    if (milestoneNum < 1 || milestoneNum > 5) {
      return res.status(400).json({
        success: false,
        message: 'Milestone number must be between 1 and 5'
      })
    }

    // Milestone 5 is POD upload - use POST /trips/:id/pod instead
    if (milestoneNum === 5) {
      return res.status(400).json({
        success: false,
        message: 'Milestone 5 (Trip Completed) is completed via POD upload. Use the Upload POD action instead.',
      })
    }

    // Find trip
    const trip = await Trip.findById(id)
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    // Check driver access
    if (!trip.driverId || trip.driverId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This trip is not assigned to you.'
      })
    }

    // Validate trip is ACTIVE
    if (trip.status !== TRIP_STATUS.ACTIVE) {
      const statusMessage =
        trip.status === TRIP_STATUS.PAUSED
          ? 'Trip is paused. Resume the trip before updating milestones.'
          : `Milestones can only be updated for ACTIVE trips. Current status: ${trip.status}`
      return res.status(400).json({
        success: false,
        message: statusMessage
      })
    }

    // Validate milestone sequence (cannot skip)

    const existingMilestone = trip.milestones.find(
      m => m.milestoneNumber === milestoneNum
    )

    if (existingMilestone) {
      return res.json({
        success: true,
        message: `Milestone ${milestoneNum} already recorded`,
        data: {
          trip,
          milestone: existingMilestone
        }
      })
    }
    // const completedMilestones = trip.milestones.length
    const completedMilestones = trip.milestones.filter(
      m => m.milestoneNumber
    ).length
    const expectedNext = completedMilestones + 1

    if (milestoneNum !== expectedNext) {
      return res.status(400).json({
        success: false,
        message: `Invalid milestone sequence. Expected milestone ${expectedNext}, got ${milestoneNum}. Milestones must be completed in order.`,
        data: {
          completedMilestones: completedMilestones,
          expectedNext: expectedNext,
          received: milestoneNum
        }
      })
    }

    // Get GPS location from request body (required)
    let { latitude, longitude } = req.body
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'GPS location is required (latitude and longitude)'
      })
    }

    // Validate coordinates
    latitude = parseFloat(latitude)
    longitude = parseFloat(longitude)

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude must be numbers'
      })
    }

    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({
        success: false,
        message: 'Latitude must be between -90 and 90'
      })
    }

    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Longitude must be between -180 and 180'
      })
    }

    // Get milestone type
    const milestoneType = getMilestoneTypeByNumber(milestoneNum)

    // Get backend meaning based on trip type
    const backendMeaning = getBackendMeaning(milestoneType, trip.tripType)

    // Get photo URLs from req.files (supports both 'photo' single and 'photos' array)
    const photoUrls = []
    if (req.files) {
      const photosArr = req.files.photos || []
      const photoSingle = req.files.photo || []
      const allFiles = [...photosArr, ...photoSingle]
      allFiles.forEach((f) => {
        if (f && f.filename) {
          photoUrls.push(`/uploads/milestones/${f.filename}`)
        }
      })
    }
    const photoUrl = photoUrls[0] || null

    const photoValidationError = ensureMilestonePhoto(trip, milestoneType, photoUrl)
    if (photoValidationError) {
      return res.status(400).json({
        success: false,
        message: photoValidationError
      })
    }

    // Create milestone object
    const milestone = {
      milestoneType,
      milestoneNumber: milestoneNum,
      timestamp: new Date(),
      location: {
        latitude,
        longitude
      },
      photo: photoUrl,
      photos: photoUrls,
      driverId: userId,
      backendMeaning
    }

    // Add milestone to trip
    trip.milestones.push(milestone)
    trip.lastDriverLocation = {
      latitude,
      longitude,
      updatedAt: new Date()
    }
    trip.audit.updatedBy = {
      userId,
      userType: toAuditUserType(userType)
    }
    await trip.save()

    // Get current milestone info for next milestone
    const currentMilestone = trip.getCurrentMilestone()
    const milestoneLabel = currentMilestone
      ? getDriverLabel(currentMilestone.milestoneType)
      : null

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType')
    await trip.populate('driverId', 'name mobile')
    await trip.populate('transporterId', 'name company mobile')
    await trip.populate('customerId', 'name mobile email isRegistered')

    emitTripMilestoneUpdated(
      trip,
      milestone,
      currentMilestone
        ? {
            milestoneNumber: currentMilestone.milestoneNumber,
            milestoneType: currentMilestone.milestoneType,
            label: milestoneLabel
          }
        : null
    )

    if (trip.customerId) {
      if (milestoneType === 'REACHED_LOCATION') {
        await triggerWatiTemplate(
          () =>
            sendVehicleReachedPickupTemplate({
              customer: trip.customerId,
              trip
            }),
          'vehicle reached pickup template'
        )
      }

      if (milestoneType === 'CONTAINER_PICKED') {
        await triggerWatiTemplate(
          () =>
            sendContainerPickedTemplate({
              customer: trip.customerId,
              trip
            }),
          'container picked template'
        )
      }
    }

    if (milestoneNum === 1 && trip.isFromBooking && trip.bookingId) {
      try {
        const paymentSnapshot = await fetchMarketplacePaymentSnapshotByTrip(trip)
        await emitMarketplacePaymentReady(trip, paymentSnapshot)
      } catch (paymentEventError) {
        console.warn(
          'Marketplace payment ready broadcast skipped:',
          paymentEventError.message || paymentEventError
        )
      }
    }

    res.json({
      success: true,
      message: `Milestone ${milestoneNum} updated successfully`,
      data: {
        trip,
        milestone,
        currentMilestone: currentMilestone
          ? {
              milestoneNumber: currentMilestone.milestoneNumber,
              milestoneType: currentMilestone.milestoneType,
              label: milestoneLabel
            }
          : null
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get current milestone
 * GET /api/trips/:id/current-milestone
 */
const getCurrentMilestone = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user?.id
    const userType = req.user?.userType

    // Find trip
    const trip = await Trip.findById(id)
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    if (userType === 'driver') {
      if (!trip.driverId || trip.driverId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This trip is not assigned to you.'
        })
      }
    } else if (userType === 'admin') {
      // allowed
    } else if (userType === 'customer') {
      if (!trip.customerId || trip.customerId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this trip.'
        })
      }
    } else if (userType === 'transporter' || userType === 'company-user') {
      if (!(await canTransporterPartyViewTripExecution(req.user, trip))) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this trip.'
        })
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied.'
      })
    }

    // Get current milestone
    const currentMilestone = trip.getCurrentMilestone()

    if (!currentMilestone) {
      return res.json({
        success: true,
        message: 'All milestones completed',
        data: {
          completed: true,
          milestoneNumber: null,
          milestoneType: null,
          label: null
        }
      })
    }

    const milestoneLabel = getDriverLabel(currentMilestone.milestoneType)

    res.json({
      success: true,
      data: {
        completed: false,
        milestoneNumber: currentMilestone.milestoneNumber,
        milestoneType: currentMilestone.milestoneType,
        label: milestoneLabel
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get trip timeline
 * GET /api/trips/:id/timeline
 */
const getTripTimeline = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user.id
    const userType = req.user.userType

    // Find trip
    const trip = await Trip.findById(id)
      .populate('driverId', 'name mobile')
      .populate('vehicleId', 'vehicleNumber')

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    if (userType === 'admin') {
      // allowed
    } else if (userType === 'customer') {
      if (trip.customerId?.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this trip.'
        })
      }
    } else if (userType === 'transporter' || userType === 'company-user') {
      if (!(await canTransporterPartyViewTripExecution(req.user, trip))) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this trip.'
        })
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters, customers, and admins can view trip timeline.'
      })
    }

    // Build timeline with all 5 milestones
    const allMilestones = [
      'CONTAINER_PICKED',
      'REACHED_LOCATION',
      'LOADING_UNLOADING',
      'REACHED_DESTINATION',
      'TRIP_COMPLETED'
    ]

    const timeline = allMilestones.map((milestoneType, index) => {
      const milestoneNumber = index + 1
      const completedMilestone = trip.milestones.find(
        m => m.milestoneNumber === milestoneNumber
      )
      // For milestone 5 (TRIP_COMPLETED), use POD photo if milestone has no photo
      let photos = completedMilestone?.photos?.length
        ? completedMilestone.photos
        : completedMilestone?.photo
          ? [completedMilestone.photo]
          : milestoneNumber === 5 && trip.POD?.photo
            ? [trip.POD.photo]
            : []
      photos = (photos || []).map((s) => String(s).trim()).filter(Boolean)
      const fallbackPhoto =
        completedMilestone?.photo ||
        (milestoneNumber === 5 ? trip.POD?.photo : null) ||
        null
      if (!photos.length && fallbackPhoto) {
        photos = [String(fallbackPhoto).trim()].filter(Boolean)
      }
      const photo = photos[0] || fallbackPhoto || null

      return {
        milestoneNumber,
        milestoneType,
        driverLabel: getDriverLabel(milestoneType),
        backendMeaning: completedMilestone
          ? completedMilestone.backendMeaning
          : null,
        completed: !!completedMilestone,
        timestamp: completedMilestone ? completedMilestone.timestamp : null,
        location: completedMilestone ? completedMilestone.location : null,
        photo,
        photos,
        driverId: completedMilestone ? completedMilestone.driverId : null
      }
    })

    res.json({
      success: true,
      data: {
        trip: {
          tripId: trip.tripId,
          status: trip.status,
          tripType: trip.tripType,
          containerNumber: trip.containerNumber,
          reference: trip.reference,
          pod: trip.POD
            ? {
                photo: trip.POD.photo,
                uploadedAt: trip.POD.uploadedAt,
                approvedAt: trip.POD.approvedAt
              }
            : null,
          completedAt: trip.completedAt || null,
          podDueAt: trip.podDueAt || null,
          closedAt: trip.closedAt || null,
          closedReason: trip.closedReason || null
        },
        timeline
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /api/trips/:id/location-trail
 * GPS breadcrumb trail for live tracking maps.
 */
const getTripLocationTrail = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user.id
    const userType = req.user.userType

    const trip = await Trip.findById(id).select(
      'status transporterId customerId driverId isFromBooking bookingId'
    )

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    if (userType === 'admin') {
      // allowed
    } else if (userType === 'driver') {
      if (!trip.driverId || trip.driverId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This trip is not assigned to you.'
        })
      }
    } else if (userType === 'customer') {
      if (!trip.customerId || trip.customerId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this trip.'
        })
      }
    } else if (userType === 'transporter' || userType === 'company-user') {
      if (!(await canTransporterPartyViewTripExecution(req.user, trip))) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this trip.'
        })
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied.'
      })
    }

    if (!TRACKABLE_STATUSES.includes(trip.status)) {
      return res.status(400).json({
        success: false,
        message: 'Location trail is only available for active, paused, or POD pending trips'
      })
    }

    const { points, total, returned } = await getLocationTrailForTrip(id, {
      since: req.query.since,
      limit: req.query.limit
    })

    return res.json({
      success: true,
      data: {
        points,
        total,
        returned
      }
    })
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message
      })
    }
    next(error)
  }
}

/**
 * GET /api/trips/shared/:token/location-trail
 * Public GPS trail for shared tracking links (valid share token required).
 */
const getSharedTripLocationTrail = async (req, res, next) => {
  try {
    const { token } = req.params

    const trip = await Trip.findOne({
      shareToken: token,
      shareTokenExpiry: { $gt: new Date() },
    }).select('_id status')

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Shared trip not found or link has expired',
      })
    }

    if (!TRACKABLE_STATUSES.includes(trip.status)) {
      return res.status(400).json({
        success: false,
        message: 'Location trail is only available for active trips',
      })
    }

    const { points, total, returned } = await getLocationTrailForTrip(trip._id.toString(), {
      since: req.query.since,
      limit: req.query.limit,
    })

    return res.json({
      success: true,
      data: {
        points,
        total,
        returned,
      },
    })
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      })
    }
    next(error)
  }
}

module.exports = {
  updateMilestone,
  getCurrentMilestone,
  getTripTimeline,
  getTripLocationTrail,
  getSharedTripLocationTrail,
}
