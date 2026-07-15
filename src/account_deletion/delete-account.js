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

        if (result.success) {

            alert("Your account has been deleted successfully.");

            window.location.href = "/api/delete-account";

        } else {

            alert(result.message);

        }

    } catch (err) {

        console.error(err);

        alert("Something went wrong.");

    }

}