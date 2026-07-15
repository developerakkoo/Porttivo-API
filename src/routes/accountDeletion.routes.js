const express = require("express");
const router = express.Router();

const {
  deleteAccount,
  getDeletedAccounts,
} = require("../controllers/accountDeletion.controller");

router.get("/delete-account", (req, res) => {
  res.json({
    success: true,
    message: "Delete Account API is working",
  });
});

router.post("/delete-account", deleteAccount);

router.get("/admin/deleted-accounts", getDeletedAccounts);

module.exports = router;