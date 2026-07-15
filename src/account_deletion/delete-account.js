const form = document.getElementById("deleteForm");

const popup = document.getElementById("popupModal");

let formData = {};

form.addEventListener("submit", function (e) {

    e.preventDefault();

    formData = {};

    formData.userType = document.getElementById("userType").value;

    const identifier = document.getElementById("identifier").value.trim();

    formData.reason = document.getElementById("reason").value.trim();

    if (identifier.includes("@")) {

        formData.email = identifier;

    } else {

        formData.mobile = identifier;

    }

    showConfirmPopup();

});

function showConfirmPopup() {

    popup.style.display = "block";

    document.getElementById("popupIcon").innerHTML = "⚠️";

    document.getElementById("popupTitle").innerHTML = "Confirm Account Deletion";

    document.getElementById("popupMessage").innerHTML =
        "Are you sure you want to permanently delete your account?";

    document.getElementById("popupButtons").innerHTML = `
        <button class="cancel" onclick="closePopup()">
            Cancel
        </button>

        <button class="delete" onclick="confirmDelete()">
            Confirm Delete
        </button>
    `;

}

function closePopup() {

    popup.style.display = "none";

}

async function confirmDelete() {

    try {

        const response = await fetch("/api/delete-account", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(formData)

        });

        const result = await response.json();

        if (response.ok && result.success) {

            document.getElementById("popupIcon").innerHTML = "✅";

            document.getElementById("popupTitle").innerHTML = "Account Deleted";

            document.getElementById("popupMessage").innerHTML = result.message;

            document.getElementById("popupButtons").innerHTML = `
                <button class="cancel" onclick="window.location.reload()">
                    OK
                </button>
            `;

        } else {

            document.getElementById("popupIcon").innerHTML = "❌";

            document.getElementById("popupTitle").innerHTML = "Account Not Found";

            document.getElementById("popupMessage").innerHTML =
                result.message || "No account found.";

            document.getElementById("popupButtons").innerHTML = `
                <button class="delete" onclick="closePopup()">
                    OK
                </button>
            `;

        }

    } catch (error) {

        console.error(error);

        document.getElementById("popupIcon").innerHTML = "❌";

        document.getElementById("popupTitle").innerHTML = "Server Error";

        document.getElementById("popupMessage").innerHTML =
            "Something went wrong. Please try again.";

        document.getElementById("popupButtons").innerHTML = `
            <button class="delete" onclick="closePopup()">
                OK
            </button>
        `;

    }

}