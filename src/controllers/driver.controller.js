const Driver = require('../models/Driver')
const Transporter = require('../models/Transporter')
const Trip = require('../models/Trip')
const { TRIP_STATUS, DRIVER_HISTORY_STATUSES } = require('../utils/tripState')
const {
  getTransporterId,
  hasPermission
} = require('../middleware/permission.middleware')
const { getDriverAvailabilityState } = require('../utils/vehicleValidation')
const { getCache, setCache, deleteCache, deleteCachePattern } = require('../utils/cache')
const logger = require('../utils/logger')

const normalizeOptionalMobile = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return null
  const cleanedMobile = String(value).replace(/\D/g, '')
  if (cleanedMobile.length !== 10) {
    return { error: `${fieldName} must be 10 digits` }
  }
  return { value: cleanedMobile }
}

const normalizeLicenseValidTill = value => {
  if (value === undefined || value === null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { error: 'License valid till must be a valid date' }
  }
  return { value: date }
}

const formatDriverResponse = driver => ({
  id: driver._id,
  mobile: driver.mobile,
  name: driver.name,
  alternateMobile: driver.alternateMobile ?? null,
  licenseNumber: driver.licenseNumber ?? null,
  licenseValidTill: driver.licenseValidTill ?? null,
  status: driver.status,
  riskLevel: driver.riskLevel,
  language: driver.language,
  walletBalance: driver.walletBalance,
  createdAt: driver.createdAt,
  updatedAt: driver.updatedAt
})

/**
 * Get driver profile
 * GET /api/drivers/profile
 */
const getProfile = async (req, res, next) => {
  try {
    const cacheKey = `driver:profile:${req.user.id}`
    const cachedProfile = await getCache(cacheKey)

    if (cachedProfile) {
      logger.info(`DRIVER PROFILE CACHE HIT: ${cacheKey}`)
      return res.status(200).json(cachedProfile)
    }

    logger.info(`DRIVER PROFILE CACHE MISS: ${cacheKey}`)

    const driver = await Driver.findById(req.user.id).populate(
      'transporterId',
      'name company mobile'
    )

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    const response = {
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        driver: {
          id: driver._id,
          mobile: driver.mobile,
          name: driver.name,
          alternateMobile: driver.alternateMobile ?? null,
          licenseNumber: driver.licenseNumber ?? null,
          licenseValidTill: driver.licenseValidTill ?? null,
          transporterId: driver.transporterId,
          transporter: driver.transporterId
            ? {
                id: driver.transporterId._id,
                name: driver.transporterId.name,
                company: driver.transporterId.company,
                mobile: driver.transporterId.mobile
              }
            : null,
          status: driver.status,
          riskLevel: driver.riskLevel,
          language: driver.language,
          walletBalance: driver.walletBalance,
          createdAt: driver.createdAt,
          updatedAt: driver.updatedAt
        }
      }
    }

    await setCache(cacheKey, response, 10 * 60)
    logger.info(`DRIVER PROFILE CACHE SET: ${cacheKey}`)

    return res.status(200).json(response)
  } catch (error) {
    next(error)
  }
}

/**
 * Update driver profile
 * PUT /api/drivers/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { name } = req.body

    // Build update object
    const updateData = {}
    if (name !== undefined) updateData.name = name?.trim()

    // Update driver
    const driver = await Driver.findByIdAndUpdate(req.user.id, updateData, {
      new: true,
      runValidators: true
    }).populate('transporterId', 'name company mobile')

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    const profileCacheKey = `driver:profile:${driver._id}`
    await deleteCache(profileCacheKey)
    logger.info(`DRIVER PROFILE CACHE REMOVE: ${profileCacheKey}`)

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        driver: {
          id: driver._id,
          mobile: driver.mobile,
          name: driver.name,
          alternateMobile: driver.alternateMobile ?? null,
          licenseNumber: driver.licenseNumber ?? null,
          licenseValidTill: driver.licenseValidTill ?? null,
          transporterId: driver.transporterId,
          transporter: driver.transporterId
            ? {
                id: driver.transporterId._id,
                name: driver.transporterId.name,
                company: driver.transporterId.company,
                mobile: driver.transporterId.mobile
              }
            : null,
          status: driver.status,
          riskLevel: driver.riskLevel,
          language: driver.language,
          walletBalance: driver.walletBalance,
          createdAt: driver.createdAt,
          updatedAt: driver.updatedAt
        }
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Update driver language preference
 * PUT /api/drivers/language
 */
const updateLanguage = async (req, res, next) => {
  try {
    const { language } = req.body

    // Validate language
    const validLanguages = ['en', 'hi', 'mr']
    if (!language || !validLanguages.includes(language.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid language. Must be one of: en, hi, mr'
      })
    }

    // Update driver language
    const driver = await Driver.findByIdAndUpdate(
      req.user.id,
      { language: language.toLowerCase() },
      {
        new: true,
        runValidators: true
      }
    )

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    const profileCacheKey = `driver:profile:${driver._id}`
    await deleteCache(profileCacheKey)
    logger.info(`DRIVER PROFILE CACHE REMOVE: ${profileCacheKey}`)

    return res.status(200).json({
      success: true,
      message: 'Language preference updated successfully',
      data: {
        driver: {
          id: driver._id,
          mobile: driver.mobile,
          name: driver.name,
          alternateMobile: driver.alternateMobile ?? null,
          licenseNumber: driver.licenseNumber ?? null,
          licenseValidTill: driver.licenseValidTill ?? null,
          language: driver.language
        }
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get drivers by transporter (for transporter to view their drivers)
 * GET /api/drivers/transporter/:transporterId
 */
const getDriversByTransporter = async (req, res, next) => {
  try {
    // Transporters and company users with manageDrivers permission can access this endpoint
    const userTransporterId = getTransporterId(req.user)
    if (!userTransporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can view drivers.'
      })
    }

    // Check permission for company users
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'manageDrivers')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view drivers.'
      })
    }

    const { transporterId } = req.params
    const { availableForTrip } = req.query

    // Verify the transporterId matches the authenticated transporter/company user's transporter
    if (transporterId !== userTransporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own drivers.'
      })
    }

    const cacheKey = `transporter:drivers:${transporterId}:${availableForTrip || 'all'}`
    const cachedDrivers = await getCache(cacheKey)

    if (cachedDrivers) {
      logger.info(`DRIVERS CACHE HIT: ${cacheKey}`)
      return res.status(200).json(cachedDrivers)
    }

    logger.info(`DRIVERS CACHE MISS: ${cacheKey}`)

    // Get all drivers for this transporter
    let drivers = await Driver.find({ transporterId: transporterId }).select(
      '-__v'
    )

    if (availableForTrip === 'true') {
      const availableDrivers = await Promise.all(
        drivers.map(async driver => {
          const availability = await getDriverAvailabilityState(
            driver._id.toString()
          )
          return { driver, availability }
        })
      )
      drivers = availableDrivers
        .filter(
          ({ driver, availability }) =>
            driver.status === 'active' && availability.isAvailable
        )
        .map(({ driver }) => driver)
    }

    const response = {
      success: true,
      message: 'Drivers retrieved successfully',
      data: {
        drivers: drivers.map(formatDriverResponse),
        count: drivers.length
      }
    }

    // Cache drivers list for 10 minutes
    await setCache(cacheKey, response, 10 * 60)

    return res.status(200).json(response)
  } catch (error) {
    next(error)
  }
}

/**
 * Create driver (for transporters)
 * POST /api/drivers
 */
const createDriver = async (req, res, next) => {
  try {
    // Transporters and company users with manageDrivers permission can create drivers
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can create drivers.'
      })
    }

    // Check permission for company users
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'manageDrivers')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to create drivers.'
      })
    }

    const {
      mobile,
      name,
      alternateMobile,
      licenseNumber,
      licenseValidTill,
      status
    } = req.body

    // Validate mobile number
    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required'
      })
    }

    const cleanedMobile = mobile.replace(/\D/g, '')
    if (cleanedMobile.length !== 10) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number must be 10 digits'
      })
    }

    const alternateMobileResult = normalizeOptionalMobile(
      alternateMobile,
      'Alternate mobile number'
    )
    if (alternateMobileResult.error) {
      return res.status(400).json({
        success: false,
        message: alternateMobileResult.error
      })
    }
    const licenseDateResult = normalizeLicenseValidTill(licenseValidTill)
    if (licenseDateResult.error) {
      return res.status(400).json({
        success: false,
        message: licenseDateResult.error
      })
    }

    // Check if driver already exists and is linked to another transporter
    const existingDriver = await Driver.findOne({ mobile: cleanedMobile })
    if (existingDriver) {
      if (
        existingDriver.transporterId &&
        existingDriver.transporterId.toString() !== transporterId
      ) {
        return res.status(409).json({
          success: false,
          message:
            'This mobile number is already linked to another transporter.'
        })
      }
      return res.status(409).json({
        success: false,
        message: 'Driver with this mobile number already exists'
      })
    }

    // Validate status if provided
    const validStatuses = ['pending', 'active', 'inactive', 'blocked']
    const driverStatus = status || 'active'
    if (!validStatuses.includes(driverStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      })
    }

    // Create driver
    const driver = await Driver.create({
      mobile: cleanedMobile,
      name: name?.trim() || '',
      alternateMobile: alternateMobileResult.value,
      licenseNumber: licenseNumber?.trim().toUpperCase() || null,
      licenseValidTill: licenseDateResult.value,
      transporterId,
      status: driverStatus
    })

    const driversCachePattern = `transporter:drivers:${transporterId}*`
    await deleteCachePattern(driversCachePattern)
    await deleteCachePattern('admin:dashboard-stats:*')
    await deleteCachePattern('admin:analytics:*')
    await deleteCachePattern('admin:drivers:*')
    await deleteCachePattern('admin:driver:*')
    logger.info('ADMIN CACHE INVALIDATION', {
      patterns: ['admin:dashboard-stats:*', 'admin:analytics:*', 'admin:drivers:*', 'admin:driver:*']
    })
    logger.info(`DRIVERS CACHE REMOVE: ${driversCachePattern}`)

    const dashCacheKey = `transporter:dashboard:${transporterId}`
    await deleteCache(dashCacheKey)
    logger.info(`DASHBOARD CACHE REMOVE: ${dashCacheKey}`)

    return res.status(201).json({
      success: true,
      message: 'Driver created successfully',
      data: { driver }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Update driver (for transporters)
 * PUT /api/drivers/:id
 */
const updateDriver = async (req, res, next) => {
  try {
    // Transporters and company users with manageDrivers permission can update drivers
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can update drivers.'
      })
    }

    // Check permission for company users
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'manageDrivers')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to update drivers.'
      })
    }

    const { id } = req.params
    const {
      name,
      mobile,
      alternateMobile,
      licenseNumber,
      licenseValidTill,
      status
    } = req.body

    // Find driver
    const driver = await Driver.findById(id)
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    // Check if driver belongs to transporter
    if (driver.transporterId?.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You do not have permission to update this driver.'
      })
    }

    // Update fields
    if (name !== undefined) {
      driver.name = name?.trim() || ''
    }

    if (mobile !== undefined) {
      const mobileResult = normalizeOptionalMobile(mobile, 'Mobile number')
      if (mobileResult.error || !mobileResult.value) {
        return res.status(400).json({
          success: false,
          message: mobileResult.error || 'Mobile number is required'
        })
      }
      if (mobileResult.value !== driver.mobile) {
        const existingDriver = await Driver.findOne({
          mobile: mobileResult.value,
          _id: { $ne: id }
        })
        if (existingDriver) {
          return res.status(409).json({
            success: false,
            message: 'This mobile number is already linked to another driver.'
          })
        }
      }
      driver.mobile = mobileResult.value
    }

    if (alternateMobile !== undefined) {
      const alternateMobileResult = normalizeOptionalMobile(
        alternateMobile,
        'Alternate mobile number'
      )
      if (alternateMobileResult.error) {
        return res.status(400).json({
          success: false,
          message: alternateMobileResult.error
        })
      }
      driver.alternateMobile = alternateMobileResult.value
    }

    if (licenseNumber !== undefined) {
      driver.licenseNumber = licenseNumber?.trim().toUpperCase() || null
    }

    if (licenseValidTill !== undefined) {
      const licenseDateResult = normalizeLicenseValidTill(licenseValidTill)
      if (licenseDateResult.error) {
        return res.status(400).json({
          success: false,
          message: licenseDateResult.error
        })
      }
      driver.licenseValidTill = licenseDateResult.value
    }

    if (status !== undefined) {
      const validStatuses = ['pending', 'active', 'inactive', 'blocked']
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        })
      }
      driver.status = status
    }

    await driver.save()

    const profileCacheKey = `driver:profile:${id}`
    await deleteCache(profileCacheKey)
    logger.info(`DRIVER PROFILE CACHE REMOVE: ${profileCacheKey}`)

    const driversCachePattern = `transporter:drivers:${transporterId}*`
    await deleteCachePattern(driversCachePattern)
    await deleteCachePattern('admin:dashboard-stats:*')
    await deleteCachePattern('admin:analytics:*')
    await deleteCachePattern('admin:drivers:*')
    await deleteCachePattern('admin:driver:*')
    logger.info('ADMIN CACHE INVALIDATION', {
      patterns: ['admin:dashboard-stats:*', 'admin:analytics:*', 'admin:drivers:*', 'admin:driver:*']
    })
    logger.info(`DRIVERS CACHE REMOVE: ${driversCachePattern}`)

    const dashCacheKey = `transporter:dashboard:${transporterId}`
    await deleteCache(dashCacheKey)
    logger.info(`DASHBOARD CACHE REMOVE: ${dashCacheKey}`)

    return res.status(200).json({
      success: true,
      message: 'Driver updated successfully',
      data: { driver }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Delete driver (for transporters)
 * DELETE /api/drivers/:id
 */
const deleteDriver = async (req, res, next) => {
  try {
    // Transporters and company users with manageDrivers permission can delete drivers
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can delete drivers.'
      })
    }

    // Check permission for company users
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'manageDrivers')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to delete drivers.'
      })
    }

    const { id } = req.params

    // Find driver
    const driver = await Driver.findById(id)
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    // Check if driver belongs to transporter
    if (driver.transporterId?.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You do not have permission to delete this driver.'
      })
    }

    // Delete driver
    await Driver.deleteOne({ _id: id })

    const profileCacheKey = `driver:profile:${id}`
    await deleteCache(profileCacheKey)
    logger.info(`DRIVER PROFILE CACHE REMOVE: ${profileCacheKey}`)

    const driversCachePattern = `transporter:drivers:${transporterId}*`
    await deleteCachePattern(driversCachePattern)
    await deleteCachePattern('admin:dashboard-stats:*')
    await deleteCachePattern('admin:analytics:*')
    await deleteCachePattern('admin:drivers:*')
    await deleteCachePattern('admin:driver:*')
    logger.info('ADMIN CACHE INVALIDATION', {
      patterns: ['admin:dashboard-stats:*', 'admin:analytics:*', 'admin:drivers:*', 'admin:driver:*']
    })
    logger.info(`DRIVERS CACHE REMOVE: ${driversCachePattern}`)

    const dashCacheKey = `transporter:dashboard:${transporterId}`
    await deleteCache(dashCacheKey)
    logger.info(`DASHBOARD CACHE REMOVE: ${dashCacheKey}`)

    return res.status(200).json({
      success: true,
      message: 'Driver deleted successfully'
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get active trip for driver
 * GET /api/drivers/trips/active
 */
const getActiveTrip = async (req, res, next) => {
  try {
    // Only drivers can access this endpoint
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This endpoint is for drivers only.'
      })
    }

    const driverId = req.user.id

    // Find active trip assigned to driver
    const activeTrip = await Trip.findOne({
      driverId,
      status: { $in: [TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED] }
    })
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('transporterId', 'name company')
      .sort({ createdAt: -1 })

    if (!activeTrip) {
      return res.status(200).json({
        success: true,
        message: 'No active trip found',
        data: {
          trip: null
        }
      })
    }

    // Get current milestone info
    const currentMilestone = activeTrip.getCurrentMilestone()

    return res.status(200).json({
      success: true,
      message: 'Active trip retrieved successfully',
      data: {
        trip: {
          ...activeTrip.toObject(),
          currentMilestone
        }
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get queued trips for driver
 * GET /api/drivers/trips/queued
 */
const getQueuedTrips = async (req, res, next) => {
  try {
    // Only drivers can access this endpoint
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This endpoint is for drivers only.'
      })
    }

    const driverId = req.user.id

    // Find queued trips assigned to driver
    const queuedTrips = await Trip.find({
      driverId,
      status: TRIP_STATUS.PLANNED
    })
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('transporterId', 'name company')
      .sort({ createdAt: 1 }) // Oldest first (FIFO)

    return res.status(200).json({
      success: true,
      message: 'Queued trips retrieved successfully',
      data: {
        trips: queuedTrips,
        count: queuedTrips.length
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get trip history for driver
 * GET /api/drivers/trips/history
 */
const getTripHistory = async (req, res, next) => {
  try {
    // Only drivers can access this endpoint
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This endpoint is for drivers only.'
      })
    }

    const driverId = req.user.id
    const { page = 1, limit = 20, status } = req.query

    // Build query - exclude PLANNED and ACTIVE trips (those are current/queued)
    const query = {
      driverId,
      status: { $in: DRIVER_HISTORY_STATUSES }
    }

    if (status) {
      query.status = status
    }

    // Pagination
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const trips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('transporterId', 'name company')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Trip.countDocuments(query)

    return res.status(200).json({
      success: true,
      message: 'Trip history retrieved successfully',
      data: {
        trips,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getProfile,
  updateProfile,
  updateLanguage,
  getDriversByTransporter,
  createDriver,
  updateDriver,
  deleteDriver,
  getActiveTrip,
  getQueuedTrips,
  getTripHistory
}
