const express = require("express");
const path = require("path");

const router = express.Router();

const {
    deleteAccount,
    getDeletedAccounts
} = require("../controllers/accountDeletion.controller");

router.get("/delete-account", (req, res) => {
    res.sendFile(
        path.join(__dirname, "../account_deletion/delete-account.html")
    );
});

router.post("/delete-account", deleteAccount);

router.get("/admin/deleted-accounts", getDeletedAccounts);

module.exports = router;