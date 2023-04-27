async function generateModuleFuncInputForm(event) {
    let deploymentId = event.target.value;
    let deployment = await fetch(`/file/manifest/${deploymentId}`)
    .then(response => response.json())
    .catch(setStatus);
    
    // TODO: This is configured only for executing the fibonacci function atm
    // and should ideally be automated to construct the needed fields from any
    // Wasm-func's description...
    let formTopDiv = document.querySelector("#execution-form fieldset > div");
    let inputFieldDiv = document.createElement("div");
    let inputFieldLabel = document.createElement("label");
    inputFieldLabel.textContent = "Iteration count for fibonacci sequence";
    let inputField = document.createElement("input");
    inputField.type = "number";
    inputField.defaultValue = "7";
    inputField.name = "iterations";
    inputFieldLabel.appendChild(inputField);
    inputFieldDiv.appendChild(inputFieldLabel);
    formTopDiv.appendChild(inputFieldDiv);
}

function addProcedureRow(listId) {
    /**
     * Constructor for the following HTML:
     * <li id="dprocedure-select-list-0">
     *   <label for="dprocedure-select-0">Select a procedure:</label>
     *   <select id="dprocedure-select-0" name="proc0" required>
     *     <option value="">
     *       Please select the next procedure:
     *     </option>
     *     <option value="{'device':<did0>,'module':<mid0>,'func':<fname0>}">
     *      [dName] [mName] [fName]
     *     </option>
     *     ...
     *   </select>
     * </li>
     */
    async function makeItem(id) {
    let li = document.createElement("li");
    li.id = `dprocedure-select-list-${id}`;
    let select = document.createElement("select");
    select.id = `dprocedure-select-${id}`;
    select.name = `proc${id}`;
    select.required = true;
    let label = document.createElement("label");
    label.for = select.id;
    label.textContent = "Select a procedure:";
    let option = document.createElement("option");
    option.value = "";
    option.textContent = "Please select the next procedure:";

    // Add placeholder first.
    select.appendChild(option);
    // Add all the different procedures (i.e., module exports) to be
    // selectable.
    // NOTE: Doing this way means quite a lot of requests that
    // will probably not change in between...
    // TODO: Show proc inputs and outputs for checking compatibility?
    let modulesResponse = await fetch("/file/module");
    let modulesData = await modulesResponse.json();
    let devicesResponse = await fetch("/file/device");
    let devicesData = await devicesResponse.json();

    // The null here means that selecting the device is left for orchestrator to decide.
    let anyDevice = { _id: null, name: "any device" };
    for (let device of [anyDevice].concat(devicesData)) {
        for (let mod of modulesData) {
        for (let exportt of mod.exports) {
            let exportOption = document.createElement("option");

            // Add data to the option element for parsing later and sending to the deploy-endpoint.
            let optionData = { "device": device._id, "module": mod._id, "func": exportt };
            // Saving value as a serialized JSON string, but could there be a
            // non-string solution?
            exportOption.value = JSON.stringify(optionData);
            // Make something that a human could understand from the interface.
            // TODO/FIXME?: XSS galore?
            exportOption.textContent = `Use ${device.name} for ${mod.name}:${exportt}`;

            select.appendChild(exportOption);
        }
        }
    }

    li.appendChild(label);
    li.appendChild(select);
    return li;
    }

    /**
     * Add a new row to the list-element with id `listId`.
     */
    async function handleAddRow(event) {
    event.preventDefault();

    let parentList = document.querySelector(`#${listId}`);
    let nextId = parentList.querySelectorAll("li").length;
    let newListItem = await makeItem(nextId);
    parentList.appendChild(newListItem);
    }

    return handleAddRow;
}

/**
 * Return a handler that submits JSON contained in a textarea-element of the
 * event target to the url.
 */
function submitJsonTextarea(url, successCallback) {
    function handleSubmit(formSubmitEvent) {
    formSubmitEvent.preventDefault();
    let json = formSubmitEvent.target.querySelector("textarea").value;

    // Disable the form for the duration of the submission (provided it is
    // inside a fieldset-element).
    formSubmitEvent.target.querySelector("fieldset").disabled = true;
    // Submit to backend that handles application/json.
    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json
        })
        // TODO The backend should preferrably always respond with JSON but
        // does not currently always do so...
        .then(function(response) { return response.json(); })
        .then(function(result) {
        if (result.success) {
            // Re-enable the form and show success message
            formSubmitEvent.target.querySelector("fieldset").disabled = false;
            if (successCallback) { successCallback(result) };
        }
        setStatus(result);
        })
        .catch(function(result) {
        // Show an error message.
        setStatus(result);
        });
    }
    return handleSubmit;
}

/**
 * Return a handler that submits (POST) a form with the
 * 'enctype="multipart/form-data"' to the url. Used for uploading files
 * along with some metadata that the server needs.
 * 
 * See:
 * https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#uploading_a_file
 */
function submitFile(url) {
    function handleSubmit(formSubmitEvent) {
    formSubmitEvent.preventDefault()
    let formData = new FormData();
    // NOTE: only one (1) file is sent.
    let fileField = formSubmitEvent.target.querySelector("input[type=file]");

    // Add the metadata found in the form.
    // NOTE: Forms more complicated than containing text inputs or
    // hierarchical/deeper than one are not handled.
    for (let [key, value] of Object.entries(formToObject(formSubmitEvent.target))) {
        switch (typeof(value))
        {
        case "string":
            formData.append(key, value);
            break;
        default:
            alert("Submitting the type '" + typeof(value) + "'' is not currently supported!")
            return;
        }
    }

    // Add the actual file.
    formData.append(fileField.name, fileField.files[0]);

    fetch(url, { method: "POST", body: formData })
        .then((resp) => resp.json())
        .then(result => {
        setStatus(result);
        })
        // TODO: This never happens with fetch(), does it? (unless explicitly
        // coded throwing an error).
        .catch(result => {
        setStatus(result)
        });
    }
    // Build up the request.
    // POST.
    // action="/file/module/upload" method="POST" enctype="multipart/form-data"
    return handleSubmit;
}

/**
 * Using HTMLElement.dataset (See:
 * https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dataset),
 * create a Javascript object from the fields i.e.:
 * - text and number -inputs become 'key:string-value' pairs,
 * - select elements' selected options become 'key:string-value' pairs,
 * - 1-dimensional ordered lists become lists of objects (based on the
 * serialized JSON in their items' value-fields). Note: The key that then
 * corresponds to this list in the result object must be found in the
 * HTML-elements field attribute 'data-json-key'!
 */
function formToObject(form) {
    let obj = {};
    
    let inputs = [
    ...form.querySelectorAll("input[type=text]"),
    ...form.querySelectorAll("input[type=number]"),
    ];
    // Text inputs.
    for (let input of inputs) {
    // HACK: List-inputs are identified by a custom field and
    // ','-characters delimit the values.
    if ("hacktype" in input.dataset && input.dataset.hacktype === "array") {
        obj[input.name] = input.value.split(",").filter(x => x.trim().length > 0);
    } else {
        obj[input.name] = input.value;
    }
    }
    
    // Select elements immediately under this form NOTE: the ":scope" selector
    // (See: https://developer.mozilla.org/en-US/docs/Web/CSS/:scope) might
    // be better?. HACK: Getting all under div (which currently excludes
    // items under ol).
    for (let select of document.querySelectorAll(`#${form.getAttribute("id")} div > select`)) {
    obj[select.name] = select.selectedOptions[0].value;
    }

    // TODO: Make a separate "arrayHandle" function.
    // TODO: Use formdata directly? See:
    // https://developer.mozilla.org/en-US/docs/Web/API/FormData/getAll#examples
    let ol = form.querySelector("ol");
    if (ol !== null && ol) {
    obj[ol.dataset.jsonKey] =
        // TODO: Does queryselectorall return the elements in the same
        // order as "listed" on the page?
        Array.from(ol.querySelectorAll("select"))
        // Parse the JSON-string hidden inside option.
        .map(x => JSON.parse(x.selectedOptions[0].value));
    }

    return obj;
}

/**
 * Transform the sourceForm's contents into JSON and put into the
 * targetTextArea.
 */
function populateWithJson(sourceForm, targetTextArea) {
    targetTextArea.value = JSON.stringify(formToObject(sourceForm), null, 2);
}

/**
 * Update the form that is used to upload a Wasm-binary with the current
 * selection of modules recorded in database.
 */
function populateWasmFormModules() {
    // Get all current modules' ids and names and add them to the list for
    // selection.
    fetch("/file/module")
    .then((resp) => resp.json())
    .then(function(modulesData) {
        let selectElem = document.querySelector("#wmodule-select");

        // Remove previous ones first and replace with newly fetched ones.
        for (let option of selectElem.querySelectorAll("option")) {
        if (option.value !== "") {
            option.remove();
        }
        }

        for (let mod of modulesData) {
        let optionElem = document.createElement("option");
        optionElem.value = mod._id;
        optionElem.textContent = mod.name;
        selectElem.appendChild(optionElem);
        }
    });
}

/**
 * Update the form that is used to request deployment execution with the
 * current selection of deployments recorded in database. TODO: Generalize
 * with same module-upload-selections func.
 */
function populateExecutionFormDeployments() {
    // Get all current deployments' ids and names and add them to the list for
    // selection.
    fetch("/file/manifest")
    .then((resp) => resp.json())
    .then(function(deploymentsData) {
        let selectElem = document.querySelector("#edeployment-select");

        // Remove previous ones first and replace with newly fetched ones.
        for (let option of selectElem.querySelectorAll("option")) {
        if (option.value !== "") {
            option.remove();
        }
        }

        for (let deployment of deploymentsData) {
        let optionElem = document.createElement("option");
        optionElem.value = deployment._id;
        optionElem.textContent = deployment.name;
        selectElem.appendChild(optionElem);
        }

        // Now that the selection is populated, add events to generate a form
        // for giving inputs that will eventually be fed into the initial func
        // of the execution sequence.
        for (option of document.querySelectorAll("#edeployment-select option")) {
        option.addEventListener("click", function(event) {
            // Remove all other children immediately under the form's "inputs area"
            // except for the deployment selector.
            let divsExpectFirst =
            document.querySelectorAll("#execution-form fieldset > div > div:not(:first-child)");
            for (div of divsExpectFirst) {
            div.remove();
            }

            generateModuleFuncInputForm(event);
        });
        }
    });
}

/**
 * Set the status bar to success if result.success or error if result.error
 */
function setStatus(result) {
    let focusBar = document.querySelector("#status");
    focusBar.classList.remove("error");
    focusBar.classList.remove("success");
    if (result.success) {
    msg = result.success;
    classs = "success";
    } else {
    // Empty the message if result is malformed.
    msg = result.err ?? ("RESPONSE MISSING FIELD `err`: " + JSON.stringify(result));
    // Default the style to error.
    classs = "error"
    }
    focusBar.textContent = msg;
    focusBar.classList.add(classs);
    // Scroll into view.
    focusBar.focus();
}

window.onload = function() {
    // Module forms:

    // Populate lists on page load.
    populateWasmFormModules();
    populateExecutionFormDeployments();

    // Module forms:

    // Swap the form's view from human-friendly to the JSON textarea. TODO: This
    // is a bit boilerplatey because repeated with deployment forms.
    document.querySelector("#module-form .input-view-switch")
        .addEventListener("click", function() {
            // Also populate the JSON field.
            let thisForm = document.querySelector("#module-form")
            let jsonForm = document.querySelector("#module-json-form");
            populateWithJson(thisForm, jsonForm.querySelector("textarea"));
            
            thisForm.classList.add("hidden");
            jsonForm.classList.remove("hidden");
        });
    // Same as above but reverse and does not fill in the form (TODO).
    document.querySelector("#module-json-form .input-view-switch")
        .addEventListener("click", function(_) {
            document.querySelector("#module-json-form").classList.add("hidden");
            document.querySelector("#module-form").classList.remove("hidden");
        });

    document
        .querySelector("#module-json-form")
        .addEventListener("submit", submitJsonTextarea("/file/module", populateWasmFormModules));

    document.querySelector("#wasm-form").addEventListener("submit", submitFile("/file/module/upload"));

    // Deployment forms:

    document
    .querySelector("#dadd-procedure-row")
    .addEventListener("click", addProcedureRow("dprocedure-sequence-list"));

    // Swap the form's view from human-friendly to the JSON textarea.
    document.querySelector("#deployment-form .input-view-switch")
        .addEventListener("click", function() {
            // Also populate the JSON field.
            let thisForm = document.querySelector("#deployment-form")
            let jsonForm = document.querySelector("#deployment-json-form");
            populateWithJson(thisForm, jsonForm.querySelector("textarea"));
            
            thisForm.classList.add("hidden");
            jsonForm.classList.remove("hidden");
        });
    // Same as above but reverse and does not fill in the form (TODO).
    document.querySelector("#deployment-json-form .input-view-switch")
        .addEventListener("click", function(_) {
            document.querySelector("#deployment-json-form").classList.add("hidden");
            document.querySelector("#deployment-form").classList.remove("hidden");
        });


    // POST the JSON found in textarea to the server.
    document
        .querySelector("#deployment-json-form")
        .addEventListener("submit", submitJsonTextarea("/file/manifest", populateExecutionFormDeployments));

    // Execution forms:

    document
    .querySelector("#execution-form")
    .addEventListener(
        "submit",
        (event) => {
        event.preventDefault();
        let deploymentObj = formToObject(event.target);
        fetch(`/execute/${deploymentObj.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(deploymentObj)
            })
            .then(resp => resp.json())
            .then(setStatus);
        }
    );

    // Database listings:

    document.querySelector("#module-deleteall-form").addEventListener("submit", (event) => {
    event.preventDefault();
    fetch("/file/module", { method: "DELETE" })
        .then(resp => resp.json())
        .then(setStatus);
    });

    document.querySelector("#device-deleteall-form").addEventListener("submit", (event) => {
    event.preventDefault();
    fetch("/file/device", { method: "DELETE" })
        .then(resp => resp.json())
        .then(setStatus);
    });
    
    // Device discovery:

    document.querySelector("#device-discovery-reset-form").addEventListener("submit", (event) => {
    event.preventDefault();
    fetch("/file/device/discovery/reset",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send nothing.
        body: "{}",
        })
        .then(resp => resp.json())
        .then(setStatus);
    });

    // Toggle visibility of UI controls.
    let controlElems = document.querySelectorAll("#selector > div");
    for (let elem of controlElems) {
        elem.addEventListener("click", function(event) {
            let previousControl = document.querySelector("#control-container > .selected");
            previousControl.classList.remove("selected");
            previousControl.classList.add("hidden");

            let targetControl = document.getElementById(event.target.dataset.controlId);
            targetControl.classList.remove("hidden");
            targetControl.classList.add("selected");
        });
    }
};