const express = require("express");

const router = express.Router();

const {
  deleteAccount,
  getDeletedAccounts,
} = require("../controllers/accountDeletion.controller");

// Public
router.post("/delete-account", deleteAccount);

// Admin
router.get("/admin/deleted-accounts", getDeletedAccounts);

module.exports = router;