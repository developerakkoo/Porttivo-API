const Driver = require("../models/Driver");
const Customer = require("../models/Customer");
const Transporter = require("../models/Transporter");

const AccountDeletion = require("../models/accountDeletion.model");

const getModel = (userType) => {
  switch (userType.toLowerCase()) {
    case "driver":
      return Driver;

    case "customer":
      return Customer;

    case "transporter":
      return Transporter;

    default:
      return null;
  }
};

/**
 * DELETE ACCOUNT
 */

exports.deleteAccount = async (req, res) => {
  try {
    const { userType, email, mobile, reason } = req.body;

    if (!userType) {
      return res.status(400).json({
        success: false,
        message: "User type is required",
      });
    }

    if (!email && !mobile) {
      return res.status(400).json({
        success: false,
        message: "Email or mobile is required",
      });
    }

    const Model = getModel(userType);

    if (!Model) {
      return res.status(400).json({
        success: false,
        message: "Invalid user type",
      });
    }

    const query = {};

    if (email) query.email = email;

    if (mobile) query.mobile = mobile;

    const user = await Model.findOne(query);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // Save history
    await AccountDeletion.create({
      userId: user._id,
      userType,
      name: user.name || "",
      email: user.email || "",
      mobile: user.mobile || "",
      reason,
    });

    // Delete account permanently
    await Model.findByIdAndDelete(user._id);

    return res.status(200).json({
      success: true,
      message: "Account deleted successfully.",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * ADMIN
 * Deleted Accounts History
 */

exports.getDeletedAccounts = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;

    const limit = Number(req.query.limit) || 20;

    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.userType) {
      filter.userType = req.query.userType;
    }

    const total = await AccountDeletion.countDocuments(filter);

    const data = await AccountDeletion.find(filter)
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};