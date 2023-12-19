/**
 * Purely (or close enough) functional (i.e. outputs are based on the inputs
 * only) utilities:
 */

/**
 * Mapping of OpenAPI 3.1.0 schema types to HTML input field types.
 * https://spec.openapis.org/oas/latest.html#data-types
 * @param {*} schema
 * @returns { string }
 */
function OpenApi3_1_0_SchemaToInputType(schema) {
    switch (schema.type) {
        case "number":
        case "integer":
            return "number";
        case "string":
            return "text";
        default:
            throw `Unsupported schema type '${schema.type}'`;
    }
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
        ...(
            Array.from(form.querySelectorAll("select"))
            // Add as 'value' the selected option's value.
            .map(x => {
                x.value = x.querySelectorAll("option")[x.selectedIndex].value;
                return x;
            })
        ),
    ];
    // Text inputs.
    for (let input of inputs) {
        let parent = obj;
        if ("parent" in input.dataset) {
            // Add this input value to a parent object.
            if (!(input.dataset.parent in obj)) {
                obj[input.dataset.parent] = {};
            }
            parent = obj[input.dataset.parent];
        }
        // HACK: List-inputs are identified by a custom field and
        // ','-characters delimit the values.
        if ("hacktype" in input.dataset && input.dataset.hacktype === "array") {
            parent[input.name] = input.value.split(",").filter(x => x.trim().length > 0);
        } else {
            parent[input.name] = input.value;
        }
    }

    // TODO: Use formdata directly? See:
    // https://developer.mozilla.org/en-US/docs/Web/API/FormData/getAll#examples
    let ol = form.querySelector("ol");
    if (ol !== null && ol) {
        obj[ol.dataset.jsonKey] =
            Array.from(ol.querySelectorAll("select"))
                // Parse the JSON-string hidden inside option.
                .map(x => JSON.parse(x.selectedOptions[0].value));
    }

    return obj;
}

/**
 * Return object representing the data found in a form (files included) for
 * submitting it later with body-parameter in `fetch`. Returns also URL where
 * the form expects to be submitted to.
 * @param {*} form The form to get the data from.
 * @returns FormData object
 */
function formDataFrom(form) {
    let formData = new FormData();

    // Add the data found in the form.
    // NOTE: Only relatively simple forms containing just text
    // inputs and one "level" are handled.
    let formObj = formToObject(form);
    for (let [key, value] of Object.entries(formObj)) {
        let valueType = typeof value;
        switch (valueType) {
            case "string":
                formData.append(key, value);
                break;
            case "object":
                let subEntries = Object.entries(value);
                if (subEntries.length === 0 || typeof subEntries[0][1] === "string") {
                    for (let [subKey, subValue] of subEntries) {
                        formData.append(`${key}[${subKey}]`, subValue);
                    }
                    break;
                }
                valueType = "object with non-string values";
            default:
                alert("Submitting the type '" + valueType + "'' is not currently supported!")
                return;
        }
    }

    // HACK: Keep track of indices for making arrays of each functions' mounts.
    let funcMountIdx = {};
    // Send all the files found.
    for (let fileField of form.querySelectorAll("input[type=file]")) {
        // HACK: Add info about mount file to its parent function.
        if ("ismount" in fileField.dataset) {
            let funcName = fileField.dataset.parent;
            if (!(funcName in funcMountIdx)) {
                funcMountIdx[funcName] = 0;
            }
            mountIdx = funcMountIdx[funcName];
            formData.append(`${funcName}[mounts][${mountIdx}][name]`, fileField.name);
            formData.append(`${funcName}[mounts][${mountIdx}][stage]`, fileField.dataset.stage);
            funcMountIdx[funcName] += 1;
        }
        formData.append(fileField.name, fileField.files[0]);
    }

    return formData;
}

/**
 * Construct a struct for value and textContent fields of a deployment sequence
 * item that use can choose from a select-element.
 * @param {*} device
 * @param {*} mod Module
 * @param {string} exportt Module export
 * @returns { { value: string, text: string } }
 */
function deploymentSequenceItem(device, mod, exportt) {
    return {
        // Data for parsing later into values compatible with the
        // deploy-endpoint.
        value: JSON.stringify({
            "device": device._id,
            // Use name for core modules, as the ID changes on each server startup.
            "module": mod.isCoreModule ? mod.name : mod._id,
            "func": exportt
        }),
        // Make something that a human could understand from the interface.
        // TODO/FIXME?: XSS galore?
        text: `Use ${device.name} for ${mod.name}:${exportt}`
    };
}
/**
 * Return list of options for the sequence-item.
 * @param {*} devicesData [{_id: string, name: string} ..}]
 * @param {*} modulesData [{_id: string, name: string, exports: [{name: string, } ..]} ..]
 * @returns [{value: string, text: string} ..]
 */
function sequenceItemSelectOptions(devicesData, modulesData) {
    let options = [
        // Add placeholder first.
        { value: "", text: "Please select the next procedure:" },
    ];

    // The null here means that selecting the device is left for orchestrator to decide.
    let anyDevice = { _id: null, name: "any device" };

    // Add all the different procedures (i.e., module exports) to be
    // selectable.
    for (let device of [anyDevice].concat(devicesData)) {
        for (let mod of modulesData) {
            if (mod.exports.length > 0) {
                for (let exportt of mod.exports) {
                    options.push(deploymentSequenceItem(device, mod, exportt.name));
                }
            } else if (device.name === "orchestrator" && mod.isCoreModule) {
                // Build the option from description instead.
                for (let path of Object.keys(mod.description.paths)) {
                    // NOTE: Removing the path's parts for just showing the assumed function name.
                    options.push(deploymentSequenceItem(device, mod, path.replace(/\/.*\//, "")));
                }
            }
            // Do not include non-core modules without uploaded Wasm's at all.
        }
    }

    return options;
}

/*******************************************************************************
 * Utilities for updating elements on the page:
 */

async function tryFetchWithStatusUpdate(path) {
    let resp;
    let json;
    try {
        resp = await fetch(path);
        json = await resp.json();
    } catch (error) {
        setStatus({ error: error });
        throw error;
    }

    if (resp.ok) {
        return json;
    } else if (json) {
        if (!json.error) {
            json.error = "error field missing";
        }
        setStatus(json);
        throw json;
    } else {
        let error = { error: f`fetch to '${path}' failed ${resp.status}` };
        setStatus(error);
        throw error;
    }
}

/**
 * Generate fields for describing the functions' interfaces and mounts.
 * @param {{exports: [{name: string, parameterCount: integer}]}} module
 * @returns
 */
function generateFunctionDescriptionFieldsFor(module) {
    // Get the data to build a form.
    let functions = module.exports;

    let functionFieldGroups = [];
    // Build the form.
    for (let { name: functionName, parameterCount } of functions) {
        let inputFieldset = document.createElement("fieldset");
        inputFieldset.name = functionName;
        // Add header showing the function that is described.
        let legend = document.createElement("legend");
        legend.textContent = functionName;
        inputFieldset.appendChild(legend);

        // Add HTTP-method chooser between GET and POST.
        let methodSelect = document.createElement("select");
        methodSelect.name = "method";
        methodSelect.dataset.parent = functionName;
        let getOption = document.createElement("option");
        getOption.value = "GET";
        getOption.textContent = "GET";
        getOption.selected = true;
        let postOption = document.createElement("option");
        postOption.value = "POST";
        postOption.textContent = "POST";
        methodSelect.appendChild(getOption);
        methodSelect.appendChild(postOption);
        inputFieldset.appendChild(methodSelect);

        function makeInputField(textContent, name, defaultValue, type="text") {
            // Create elems.
            let inputFieldDiv = document.createElement("div");
            let inputFieldLabel = document.createElement("label");
            let inputField = document.createElement("input");

            // Fill with data.
            inputFieldLabel.textContent = textContent;
            // NOTE: This identifies which parameter associates with which function
            inputField.dataset.parent = functionName;
            inputField.name = name;
            inputField.value = defaultValue;
            inputField.type = type;

            inputFieldLabel.appendChild(inputField);
            inputFieldDiv.appendChild(inputFieldLabel);

            return inputFieldDiv;
        }

        if (parameterCount > 0) {
            for (let i = 0; i < parameterCount; i++) {
                let inputFieldDiv = makeInputField(`Parameter #${i}`, `param${i}`, "integer");
                inputFieldset.appendChild(inputFieldDiv);
            }
        } else {
            // Show that there are no parameters.
            let text = document.createElement("p");
            text.textContent = "No parameters.";
            inputFieldset.appendChild(text);
        }

        // Add field for function output.
        let outputFieldDiv = makeInputField("Output", "output", "integer");
        inputFieldset.appendChild(outputFieldDiv);

        function makeMountField(name) {
            let x = makeInputField(name, name, "", type="file");
            // Add stage selector for when this mount is expected at supervisor.
            let stageSelect = document.createElement("select");
            stageSelect.name = "stage";
            stageSelect.dataset.parent = functionName;
            // Deployment
            let deploymentOption = document.createElement("option");
            deploymentOption.value = "deployment";
            deploymentOption.textContent = "Deployment";
            // Set the stage to 'deployment' by default.
            deploymentOption.selected = true;
            stageSelect.appendChild(deploymentOption);
            // Execution.
            let executionOption = document.createElement("option");
            executionOption.value = "execution";
            executionOption.textContent = "Execution";
            stageSelect.appendChild(executionOption);
            // Output.
            let outputOption = document.createElement("option");
            outputOption.value = "output";
            outputOption.textContent = "Output";
            stageSelect.appendChild(outputOption);

            // Set the stage to the file's dataset when option changes.
            stageSelect.addEventListener("change", (event) => {
                x.querySelector("input[type=file]").dataset.stage = event.target.value;

                if (event.target.value === "output") {
                    // If output is selected, it changes the output field to a
                    // MIME-type selector.
                    // Remove text input field.
                    let outputFieldParent = outputFieldDiv.parentElement;
                    outputFieldDiv.querySelector("input").remove()
                    // Add select.
                    let outputMimeSelect = document.createElement("select");
                    outputMimeSelect.name = "output";
                    outputMimeSelect.dataset.parent = functionName;
                    // Add the different options.
                    for (let mime of ["image/jpg", "image/jpeg", "image/png"]) {
                        let option = document.createElement("option");
                        option.value = mime;
                        option.textContent = mime;
                        outputMimeSelect.appendChild(option);
                    }
                    // Add the select in place of the input.
                    outputFieldParent.appendChild(outputMimeSelect);
                } else {
                    outputFieldDiv.querySelector("input").disabled = false;
                    outputFieldDiv.querySelector("input").value = "integer";
                }
            });
            x.querySelector("input[type=file]").dataset.stage = stageSelect.value;

            x.appendChild(stageSelect);

            // Add flag for knowing later that this is a mount.
            x.querySelector("input").dataset.ismount = true;
            return x;
        }

        // Add button for adding mounts.
        let mountsSpan = document.createElement("span");
        let mountsDiv = document.createElement("div");
        mountsDiv.classList.add("mounts");
        mountsSpan.appendChild(mountsDiv);
        let addMountButton = document.createElement("button");
        addMountButton.textContent = "Add mount";
        let addMountNameFieldDiv = makeInputField("Mount name", "mountName", "").querySelector("label");
        mountsSpan.appendChild(addMountNameFieldDiv);
        addMountButton.addEventListener("click", (event) => {
            event.preventDefault();
            let mountFieldName = addMountNameFieldDiv.querySelector("input").value;
            let mountFieldDiv = makeMountField(mountFieldName);
            inputFieldset.querySelector(".mounts").appendChild(mountFieldDiv);
        });
        mountsSpan.appendChild(addMountButton);
        inputFieldset.appendChild(mountsSpan);

        functionFieldGroups.push(inputFieldset);
    }

    return functionFieldGroups;
}

async function generateParameterFieldsFor(deployment) {
    // Get the data to build a form.
    let { request } = getStartEndpoint(deployment);

    let fieldDivs = [];
    // Build the form.
    for (let param of request.parameters) {
        // Create elems.
        let inputFieldDiv = document.createElement("div");
        let inputFieldLabel = document.createElement("label");
        let inputField = document.createElement("input");

        // Fill with data.
        inputFieldLabel.textContent = param.name;
        inputField.type = OpenApi3_1_0_SchemaToInputType(param.schema);
        inputField.name = param.name;

        // Add to form.
        inputFieldLabel.appendChild(inputField);
        inputFieldDiv.appendChild(inputFieldLabel);

        fieldDivs.push(inputFieldDiv);
    }

    if (request.request_body) {
        // Get the mounts described for the function.
        let modulee = (await fetchModule(deployment.sequence[0].module))[0];
        let funcMounts = modulee.mounts[deployment.sequence[0].func];
        let execMounts = Object.fromEntries(
            Object.entries(funcMounts)
                .filter(([_, mount]) => mount.stage === "execution")
        );

        files = [];

        let { media_type: fileMediaType, schema: fileSchema, encoding: fileEncoding } =  request.request_body;
        if (fileMediaType === "multipart/form-data" && fileSchema.type === "object") {
            // (Single) File upload based on media type.
            for (let [name, metadata] of Object.entries(fileSchema.properties)) {
                console.assert(
                    metadata.type === "string",
                    "When inputting a file (using multipart/form-data), the type must be 'string' to indicate the binary data contained in the file"
                );
                // Do not add deployment-stage files to the form unnecessarily.
                if (name in execMounts) {
                    files.push({ name: name, mediaType: fileEncoding[name]["contentType"] });
                }
            }
        } else if (fileMediaType) {
            // Just a single file.
            files = [{name: "inputFile", mediaType: fileMediaType}];
        }

        for (let file of files) {
            let fileInputDiv = document.createElement("div");
            let fileInputFieldLabel = document.createElement("label");
            let fileInputField = document.createElement("input");
            // Data.
            let executeFileUploadId = `execute-form-${file.mediaType}-${file.name}`;
            fileInputFieldLabel.textContent = `File to mount as '${file.name}' (${file.mediaType}):`;
            fileInputFieldLabel.htmlFor = executeFileUploadId;
            fileInputField.id = executeFileUploadId;
            // Name used when mapping to input in function (OpenAPI) description.
            fileInputField.name = file.name;
            // Media type used when mapping to input in function (OpenAPI) description.
            fileInputField.mediaType = file.mediaType;
            fileInputField.type = "file";
            // Add to form.
            fileInputDiv.appendChild(fileInputFieldLabel);
            fileInputDiv.appendChild(fileInputField);

            fieldDivs.push(fileInputDiv);
        }
    }

    return fieldDivs;
}

function addProcedureRow(listId, devicesData, modulesData) {
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
        let select = document.createElement("select");
        select.id = `dprocedure-select-${id}`;
        select.name = `proc${id}`;
        select.required = true;
        let options = sequenceItemSelectOptions(devicesData, modulesData);
        fillSelectWith(options, select, true);

        let label = document.createElement("label");
        label.for = select.id;
        label.textContent = "Select a procedure:";

        let li = document.createElement("li");
        li.id = `dprocedure-select-list-${id}`;
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

        return newListItem;
    }

    return handleAddRow;
}

/**
 * Return a handler that submits (POST) a form with the
 * 'enctype="multipart/form-data"' to the url. Used for uploading files
 * along with other fields of the form in the body.
 *
 * See:
 * https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#uploading_a_file
 */
function submitFormData(url) {
    function handleSubmit(formSubmitEvent) {
        formSubmitEvent.preventDefault()
        let formData = formDataFrom(formSubmitEvent.target);
        // NOTE: Semi-hardcoded route parameter! Used e.g. in '/file/module/:id/upload'.
        if (formData.has("id")) {
            url = url.replace(":id", formData.get("id"));
            // Remove in order not to resend.
            formData.delete("id");
        }

        apiCallSetStatus(url, "POST", formData, false);
    }

    return handleSubmit;
}

/**
 * Clear the current options in the select-element and add new ones using the
 * given list of `value` and `text` fields.
 * @param {*} valueAndTextData List of objects with `value` and `text` fields.
 * @param {*} selectElem The `select` element to populate with options.
 */
function fillSelectWith(valueAndTextData, selectElem, removePlaceholder=false) {
    // Remove previous ones first and replace with newly fetched ones.
    for (let option of selectElem.querySelectorAll("option")) {
        if (option.value !== "" || removePlaceholder) {
            option.remove();
        }
    }

    for (let x of valueAndTextData) {
        let optionElem = document.createElement("option");
        optionElem.value = x.value;
        optionElem.textContent = x.text;
        selectElem.appendChild(optionElem);
    }
}

/**
 * Set the status bar to signify different states described by key-value pair in
 * the `result` parameter.
 * @param {{ success: NonFalsiable } | { error: NonFalsiable, errorText: string }} result Result object.
 */
function setStatus(result) {
    // Do manual typing in JavaScript.
    const isValidResultObject = result.success || (
        result.error && typeof(result.errorText) === "string"
    );

    if (!isValidResultObject) {
        result = {
            error: true,
            errorText: `Developer failure - bad object format: ${JSON.stringify(result, null, 2)}`
        };
    }

    // Reset the status completely.
    let statusText = document.querySelector("#status p");
    statusText.textContent = "";
    statusText.classList.remove("hidden");
    statusText.classList.remove("error");
    statusText.classList.remove("success");

    // Select appropriate content and styling.
    if (result.error) {
        statusText.classList.add("error");
        statusText.textContent = result.errorText;
    } else {
        statusText.classList.add("success");
        statusText.textContent = JSON.stringify(result.success, null, 4);
    }

    // Scroll the status bar into view.
    statusText.focus();
}

/*******************************************************************************
 * Event listeners:
 */

/**
 * Using the module-ID in the event, generate a form for describing functions'
 * interfaces and (module) mounts.
 * @param {*} event The event that triggered this function.
 */
async function setupModuleDescriptionFields(event) {
    // Remove all other elements from the form except for the module
    // selector.
    let divsWithoutFirst =
        document.querySelectorAll("#module-properties-form fieldset > div > div:not(:first-child)");
    for (div of divsWithoutFirst) {
        div.remove();
    }

    // Add fields based on the selected module.
    let moduleId = event.target.value;
    if (!moduleId) {
        // Assume the placeholder was selected and thus there is nothing to
        // show.
        return;
    }
    let modulee = (await fetchModule(moduleId))[0];

    let formTopDiv = document.querySelector("#module-properties-form fieldset > div");
    for (let div of generateFunctionDescriptionFieldsFor(modulee)) {
        formTopDiv.appendChild(div);
    }
}

/**
 * Fill in the deployment fields onto the designated form.
 * @param {{id: string, name:string, sequence: [{device: string, module: string, func: string }]}} deployment
 */
async function setupDeploymentUpdateFields(deployment, devices, modules) {
    // Add basic functionalities first to the empty form.

    // Remove the button for adding new procedure rows (if it exists).
    const nextRowButtonId = "dupdate-procedure-row";
    document.querySelector(`#${nextRowButtonId}`)?.remove();
    // And add it again, resulting in only one button existing at all times.
    let nextButton = document.createElement("button");
    nextButton.id = nextRowButtonId;
    nextButton.textContent = "Next";
    nextButton
        .addEventListener(
            "click",
            // NOTE: This means that the data is queried only once when opening
            // this tab and new rows won't have the most up-to-date data.
            addProcedureRow("dprocedure-sequence-list", devices, modules)
        );

    // Add the button under the list in the same div.
    document
        .querySelector("#duprocedure-sequence-list")
        .parentElement
        .appendChild(nextButton);

    // Delete any existing procedure rows.
    for (let item of document.querySelectorAll("#duprocedure-sequence-list li")) {
        item.remove();
    }
    if (deployment) {
        // Now add the existing deployment content to the fields.
        // ID into a non-editable field.
        document.querySelector("#duid").value = deployment._id;
        // Name.
        document.querySelector("#duname").value = deployment.name;
        // Sequence.
        for (let { device: deviceId, module: moduleId, func } of deployment.sequence) {
            // TODO: Delete this joke.
            let stepItem = await addProcedureRow("duprocedure-sequence-list", devices, modules)({
                preventDefault: () => { },
            });

            let optionElem = stepItem.querySelector("option");
            let { value: value, text: textContent } = deploymentSequenceItem(devices.find(x => x._id === deviceId), modules.find(x => x._id === moduleId), func);
            optionElem.value = value;
            optionElem.textContent = textContent;
        }
    }
}

function handleExecutionSubmit(event) {
    submitFormData("/execute/:id")(event);
}

/**
 * Using the deployment-ID in the event, generate a form for submitting
 * inputs that start the deployment.
 * @param {*} event The event that triggered this function.
 */
async function setupExecutionParameterFields(event) {
    // Remove all other elements from the form except for the deployment
    // selector.
    let divsWithoutFirst =
        document.querySelectorAll("#execution-form fieldset > div > div:not(:first-child)");
    for (div of divsWithoutFirst) {
        div.remove();
    }

    // Add new fields based on the selected deployment.
    let deploymentId = event.target.value;
    if (!deploymentId) {
        // Assume the placeholder was selected and thus there is nothing to
        // show.
        return;
    }
    let deployment = await fetchDeployment(deploymentId);

    let formTopDiv = document.querySelector("#execution-form fieldset > div");
    for (let div of (await generateParameterFieldsFor(deployment))) {
        formTopDiv.appendChild(div);
    }
}

/*******************************************************************************
 * Tabs:
 */

/**
 * Mapping of tab-ids to functions to fetch the needed data for the tab and then
 * set up the tab's elements.
 *
 * Used so that each tab runs its own setup-function whenever it is selected.
 */
function setupTab(tabId) {
    const tabSetups = {
        "resource-listing"   : setupResourceListingTab,
        "module-create"      : setupModuleCreateTab,
        "module-description" : setupModuleUploadTab,
        "deployment-create"  : setupDeploymentCreateTab,
        "deployment-update"  : setupDeploymentUpdateTab,
        "deployment-action"  : setupDeploymentActionTab,
        "execution-start"    : setupExecutionStartTab,
    };

    tabSetups[tabId]();
}

/** Return suffix for URL used in GETting a resource or many. */
const idSuffix = (id) => id ? ("/" + id) : "";
/** Fetch specific device if given ID, otherwise all of them. */
const fetchDevice     = async (id) => fetch(`/file/device${idSuffix(id)}`).then(resp => resp.json());
/** Fetch specific module if given ID, otherwise all of them. */
const fetchModule     = async (id) => fetch(`/file/module${idSuffix(id)}`).then(resp => resp.json());
/** Fetch specific deployment if given ID, otherwise all of them. */
const fetchDeployment = async (id) => fetch(`/file/manifest${idSuffix(id)}`).then(resp => resp.json());

/**
 * Needs data about:
 * - All devices
 * - All modules
 * - All deployments
 */
async function setupResourceListingTab() {
    const devices = await fetchDevice();
    const modules = await fetchModule();
    const deployments = await fetchDeployment();

    // TODO: Make a nice listing of the resources.
}

/**
 * Needs no data.
 */
async function setupModuleCreateTab() {
    // NOTE: This is here just for the sake of consistency.
}

/**
 * Update the form that is used to add descriptions to the current
 * selection of modules recorded in database.
 *
 * Needs data about:
 * - All modules
 */
async function setupModuleUploadTab() {
    const modules = await fetchModule();

    let selectElem = document.querySelector("#wmodule-select");

    // Remove previous ones first and replace with newly fetched ones.
    for (let option of selectElem.querySelectorAll("option")) {
        if (option.value !== "") {
            option.remove();
        }
    }

    for (let mod of modules) {
        let optionElem = document.createElement("option");
        optionElem.value = mod._id;
        optionElem.textContent = mod.name;
        selectElem.appendChild(optionElem);
    }
}

/**
 * Needs data about:
 * - All devices
 * - All modules
 */
async function setupDeploymentCreateTab() {
    const devices = await fetchDevice();
    const modules = await fetchModule();

    // (re)Add the button for adding new procedure rows.
    const nextRowButtonId = "dadd-procedure-row";
    document.querySelector(`#${nextRowButtonId}`)?.remove();
    let nextButton = document.createElement("button");
    nextButton.id = nextRowButtonId;
    nextButton.textContent = "Next";
    nextButton
        .addEventListener(
            "click",
            // NOTE: This means that the data is queried only once when opening
            // this tab and new rows won't have the most up-to-date data.
            addProcedureRow("dprocedure-sequence-list", devices, modules)
        );

    // Add the button under the list in the same div.
    document
        .querySelector("#dprocedure-sequence-list")
        .parentElement
        .appendChild(nextButton);

    // If there is any existing procedure rows, update them as well.
    for (let select of document.querySelectorAll("#dprocedure-sequence-list select")) {
        fillSelectWith(sequenceItemSelectOptions(devices, modules), select, true);
    }
}

/**
 * Needs data about:
 * - All devices (after deployment selected)
 * - All modules (after deployment selected)
 * - All deployments
 */
async function setupDeploymentUpdateTab() {
    const deployments = await fetchDeployment();

    const form = document.querySelector("#deployment-update-form");

    fillSelectWith(
        deployments.map((x) => ({ value: x._id, text: x.name })),
        form.querySelector("#udeployment-select")
    );
}

/**
 * Needs data about:
 * - All deployments
 */
async function setupDeploymentActionTab() {
    const deployments = await fetchDeployment();

    fillSelectWith(
        deployments.map((x) => ({ value: x._id, text: x.name })),
        document.querySelector("#damanifest-select")
    );
}

/**
 * Needs data about:
 * - All deployments
 */
async function setupExecutionStartTab() {
    const deployments = await fetchDeployment();

    fillSelectWith(
        deployments.map((x) => ({ value: x._id, text: x.name })),
        document.querySelector("#edeployment-select")
    );
}

/*******************************************************************************
 * Page initializations:
 */

/**
 * Add event handlers for showing and hiding different tabs.
 */
async function addHandlersToTabSelectors() {
    // Open up the currently selected tab.
    let selectedTab = document.querySelector('#selector input[name="tab-selector"]:checked')
        || document.querySelector('#selector input[name="tab-selector"]');
    let selectedTabId = selectedTab.dataset.tabId;
    let initialTabToShow = document.getElementById(selectedTabId);
    initialTabToShow.classList.remove("hidden");
    initialTabToShow.classList.add("selected");
    // Also ensure the matching radiobutton is always checked.
    selectedTab.checked = true;
    // Perform the initial setup of the tab.
    setupTab(selectedTabId);

    // Add event handlers for showing and hiding different tabs.
    let tabElems = document.querySelectorAll("#selector input");
    for (let elem of tabElems) {
        elem.addEventListener("input", function (event) {
            const targetTabId = event.target.dataset.tabId;
            // Call this tab's initialization function.
            setupTab(targetTabId)

            // Hide previous tab.
            let previousTab = document.querySelector("#tab-container > .selected");
            previousTab.classList.remove("selected");
            previousTab.classList.add("hidden");

            // Show the selected tab.
            let tabToShow = document.getElementById(targetTabId);
            tabToShow.classList.remove("hidden");
            tabToShow.classList.add("selected");
        });
    }
}

async function apiCallSetStatus(url, method, body, headers={"Content-Type": "application/json"}) {
    let result = await apiCall(url, method, body, headers);
    setStatus(result);
}


/**
 * Add event handlers for the forms creating or updating a module.
 */
function addHandlersToModuleForms() {
    document.querySelector("#module-form")
        // NOTE: The "submit" event is used in order to have the form make
        // required-field etc. checks automatically.
        .addEventListener("submit", submitFormData("/file/module"));

    document
        .querySelector("#module-properties-form")
        .addEventListener("submit", submitFormData("/file/module/:id/upload"));

    document
        .querySelector("#wmodule-select")
        .addEventListener("change", async (event) => {
            setupModuleDescriptionFields(event);
        });
}

/**
 * Add event handlers for the forms creating or sending a deployment.
 */
function addHandlersToDeploymentForms() {
    document.querySelector("#deployment-form")
        .addEventListener("submit", function (event) {
            event.preventDefault();
            const deploymentObj = formToObject(event.target);
            apiCallSetStatus("/file/manifest", "POST", JSON.stringify(deploymentObj));

        });

    document.querySelector("#deployment-update-form")
        .addEventListener("submit", async function (event) {
            event.preventDefault();
            const deploymentObj = formToObject(event.target);
            await apiCallSetStatus(`/file/manifest/${deploymentObj.id}`, "PUT", JSON.stringify(deploymentObj));

            // Hide the form after the update.
            document.querySelector("#deployment-update-form div div:nth-child(2)").classList.add("hidden");
        });

    document
        .querySelector("#deployment-action-form")
        .addEventListener(
            "submit",
            async (event) => {
                event.preventDefault();
                let deploymentObj = formToObject(event.target);
                apiCallSetStatus(`/file/manifest/${deploymentObj["id"]}`, "POST", JSON.stringify(deploymentObj));
            }
        );

    document
        .querySelector("#udeployment-select")
        .addEventListener("change", async (event) => {
            if (!event.target.value) {
                // Hide again.
                document.querySelector("#deployment-update-form div div:nth-child(2)").classList.add("hidden");
                return
            }
            const deployment = await fetchDeployment(event.target.value);
            const devices = await fetchDevice();
            const modules = await fetchModule();
            // Show the deployment form.
            document.querySelector("#deployment-update-form div div:nth-child(2)").classList.remove("hidden");
            setupDeploymentUpdateFields(deployment, devices, modules);
        });
}

/**
 * Add event handlers for the forms executing a deployment.
 */
function addHandlersToExecutionForms() {
    document
        .querySelector("#execution-form")
        .addEventListener("submit", handleExecutionSubmit);

    // When the selection is populated, this event handler sets up a form for
    // parameter inputs.
    document
        .querySelector("#edeployment-select")
        .addEventListener("change", setupExecutionParameterFields);
}

/**
 * Add event handlers for the buttons performing simple READ or DELETE
 * operations on resources.
 */
function addHandlersToResourceListings() {
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

    document.querySelector("#manifest-deleteall-form").addEventListener("submit", (event) => {
        event.preventDefault();
        fetch("/file/manifest", { method: "DELETE" })
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
}

/*******************************************************************************
 * Main:
 */

window.onload = function () {
    addHandlersToTabSelectors();
    addHandlersToResourceListings();
    addHandlersToModuleForms();
    addHandlersToDeploymentForms();
    addHandlersToExecutionForms();
};

