const form = document.getElementById("deleteForm");

const modal = document.getElementById("confirmModal");

let formData = {};

form.addEventListener("submit", function (e) {

    e.preventDefault();

    formData.userType = document.getElementById("userType").value;

    const identifier = document.getElementById("identifier").value.trim();

    formData.reason = document.getElementById("reason").value.trim();

    if (identifier.includes("@")) {

        formData.email = identifier;

    } else {

        formData.mobile = identifier;

    }

    modal.style.display = "block";

});

function closeModal(){

    modal.style.display="none";

}

async function deleteAccount() {

    closeModal();

    try {

        const response = await fetch("/api/delete-account", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            alert(result.message || "Account not found.");
            return;
        }

        alert("✅ Account deleted successfully.");

        window.location.reload();

    } catch (error) {

        console.error(error);

        alert("Something went wrong. Please try again.");

    }

}