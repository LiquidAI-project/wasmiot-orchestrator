const { Console } = require('console');
var http = require('http'),
    fileSystem = require('fs'),
    path = require('path');
const { findSourceMap } = require('module');
var REQUIREDPACKAGES = [];
var DEVICEMANIFEST;
var DEVICEDESCRIPTION;


http.createServer(function (request, response) {
    if (request.method === "POST") //if client is sending a POST request, log sent data
    {
        let data = '';
        console.log('received POST');
        request.on('data', chunk => {
            data += chunk;
        });
        //TODO: move handling after saving to local file in case of problems
        request.on('end', () => {
            if (Object.keys(JSON.parse(data)).includes('architecture')) {
                console.log(' --- this is a device description --- ');
                fileSystem.writeFile('./files/devicedescription.json', data, function (err) {
                    if (err) return console.log(err);
                    console.log('--- data written to file devicedescription.json ---');
                    response.end();
                });
            }
            //save sent json content of manifest to a json file
            else fileSystem.writeFile('./files/manifest.json', data, function (err) {
                if (err) return console.log(err);
                console.log('data written to file manifest.json');
                response.end(startSearch()); //todo: pass to checkModule
            });
            response.end();
        });
    }

    if (request.method === "GET" && request.url === "/") {
        console.log("received GET");
        var filePath = path.join(__dirname, 'files/simple.wasm'); //hardcoded filepath to served file
        //TODO: serve different files based on request
        var stat = fileSystem.statSync(filePath);

        response.writeHead(200, {
            'Content-Type': 'application/wasm',
            'Content-Length': stat.size
        });

        var readStream = fileSystem.createReadStream(filePath);
        readStream.on('data', function (data) {
            var flushed = response.write(data);
            // pause the stream when there's already data there
            if (!flushed)
                readStream.pause();
        });

        response.on('drain', function () {
            // Resume the read stream when the write stream is empty
            readStream.resume();
        });

        readStream.on('end', function () {
            response.end();
        });
    }
    else if (request.method === 'GET') {
        var filePath = path.join(__dirname, request.url);
        console.log(filePath);

        var stat = fileSystem.statSync(filePath);

        if (filePath.endsWith('ico')) { var contenttype = 'image/x-image' }
        else { contenttype = 'text/html' }
        response.writeHead(200, {
            'Content-Type': contenttype,
            'Content-Length': stat.size
        });
        var readStream = fileSystem.createReadStream(filePath);
        readStream.on('data', function (data) {
            var flushed = response.write(data);
            // pause the stream when there's already data there
            if (!flushed)
                readStream.pause();
        });

        response.on('drain', function () {
            // Resume the read stream when the write stream is empty
            readStream.resume();
        });

        readStream.on('end', function () {
            response.end(console.log('ended readstream, listening'));
        });


    }

}).listen(3000);

const getDirectories = srcPath => fileSystem.readdirSync(srcPath).filter(file => fileSystem.statSync(path.join(srcPath, file)).isDirectory());

//searches the server for modules that satisfy device description and manifest
function startSearch() {
    DEVICEDESCRIPTION = getDeviceDescription();
    DEVICEMANIFEST = getManifest();
    var modules = getDirectories("./modules"); //fetch name of the directories of every module
    checkModules(DEVICEMANIFEST, DEVICEDESCRIPTION, modules);
}

function checkModules(deviceManifest, deviceDescription, modules) {
    //go through all of the modules the server has
    for (var i in modules) {
        checkIndividualModule(deviceManifest, deviceDescription, modules[i]);
    }
}

function checkIndividualModule(deviceManifest, deviceDescription, modulename) {
    //TODO: handle superdependencies of modules
    //TODO: handle loops in superdepency
    //TODO: find most satisfying group of candidates 
    var module = JSON.parse(getModuleJSON(modulename));
    deviceDescription = JSON.parse(deviceDescription);
    deviceManifest = JSON.parse(deviceManifest);
    checkArchitecture(deviceDescription, module);
    //checkPlatform(deviceDescription, module);
    checkPeripherals(deviceDescription, module);
    checkInterfaces(deviceManifest, module);
    handleSuperDependencies(deviceDescription, module);
    //checkSuperdependencies(module);
    //TODO: check for superdependencies in module's metadata
}


//adds superdependencies to the list of modules
function handleSuperDependencies(deviceDescription, module){
checkModuleList(module); //TODO: check that the dependency is not on the list already
checkArchitecture(deviceDescription, module)

console.log("current candidates!");
console.log(REQUIREDPACKAGES);
//TODO:check if module is suitable for platf/arch/peripherals
}

startSearch();

//returns true if dependency is already found in the modulelist for candidates
function checkModuleList(modulemetadata){
    
    console.log('SUPERDEPENDENCIES');
    if (Object.keys(getModuleDependencies(modulemetadata) === undefined )){console.log('NO dependencies'); return false};
var dependencies = Object.keys(getModuleDependencies(modulemetadata)); //grab list of names inside object "dependencies"
var modulelist = REQUIREDPACKAGES;


    for (var i in dependencies){
        console.log(i);
    if (!modulelist.includes(dependencies[i]) && !REQUIREDPACKAGES.includes(dependencies[i])){
        console.log('--- module was not found in REQUIREDPACKAGES --- ');
        REQUIREDPACKAGES.push(dependencies[i]);
        addToCandidateList(dependencies[i]);
        return false;
    }

    }
    console.log('--- CURRENT REQUIRED MODULES --- ');
    return true;

}

function addToCandidateList(module){
    fileSystem.appendFile('./files/solutionCandidates.txt', JSON.stringify(module.id) + ' : ' + getModuleInterfaces(module), function (err) {
        if (err) throw err;
        console.log('Candidate module has been saved');
    });
}

//checks Architecture and platform supported by module
function checkArchitecture(deviceDescription, module) {
    //TODO: check that device architecture and module architecture match
    console.log(' ----- devicedescription -----');
    console.log(deviceDescription);
    console.log(' ----- modulemetadata -----');
    console.log(module);
    if (deviceDescription.architecture === module.architecture
        && deviceDescription.platform
        === module.platform) {
        console.log("architecture and platform matches!");
        return true;
    }
    return false;
}

//returns the json from a module based on the name
function getModuleJSON(modulename) {
    let startpath = path.join(__dirname, 'modules');
    var truepath = path.join(startpath, modulename, 'modulemetadata.json');
    return fileSystem.readFileSync(truepath, 'UTF-8', function (err, data) {
        if (err) return console.log(err + " couldn't read the file!");
        manifest = JSON.parse(data);
    });
}


//checks whether peripherals in device description and  module metadata match
function checkPeripherals(deviceDescription, module) {
    if (isSubset(deviceDescription.peripherals, module.peripherals)) {
        console.log("Module peripherals match!");
        return true;
    }
    else { console.log("module peripherals do not match"); return false; }
}

function checkInterfaces(deviceManifest, module) {
    //checks if all required interfaces are offered by module
    console.log(" -- offered interfaces from module -- ")
    console.log(module.interfaces);
    console.log(" -- interfaces required -- ");
    console.log(getInterfaces(deviceManifest));
    var fulfilledInterfaces = 0;
    for (var i in getInterfaces(deviceManifest)) {
        if (module.interfaces.includes(getInterfaces(deviceManifest)[i])) {
            fulfilledInterfaces++;

        }
    }
    if (fulfilledInterfaces == getInterfaces(deviceManifest).length) {
        console.log("--- manifest interfaces satisfied --- ");
        return true;
    }
    else {
        console.log("--- manifest interfaces not satisfied --- ");
        return false;
    }
}

//reads the manifest sent by client
function getDeviceDescription() {
    //TODO: change to accept path of manifest
    return fileSystem.readFileSync('./files/devicedescription.json', 'UTF-8', function (err, data) {
        if (err) return console.log(err + " couldn't read the file!");

        manifest = JSON.parse(data);
    });
}

/*
function checkModule(modulemeta) {
    var modulematadata = modulemeta;
    var deviceDescription = fileSystem.readFile('./files/devicedescription.json', 'UTF-8', function (err, data) {
        if (err) return console.log(err);

        console.log('---- Device description file has been read ----')
        deviceDescription = JSON.parse(data);

        checkCandidate(deviceDescription, modulemeta);
    });


}

//check if candidate is suitable for the role on the device
function checkCandidate(deviceDescription, moduleMetadata) {

    //check if architecture and peripherals match
    if (checkArchitectureAndPeripherals(deviceDescription, moduleMetadata)) {

        console.log("--- module is suitable for device and platform --- ");
        if (!CANDIDATEPACKAGE.includes(moduleMetadata.id)) {
            CANDIDATEPACKAGE.push(moduleMetadata.id)
            console.log("adding package to candidate modules");
            console.log(CANDIDATEPACKAGE);

        }
        var manifest = getManifest();
        console.log(manifest);
        digestManifest(JSON.parse(manifest), moduleMetadata);

    }

}
*/

//reads the manifest sent by client
function getManifest() {
    //TODO: change to accept path of manifest
    return fileSystem.readFileSync('./files/manifest.json', 'UTF-8', function (err, data) {
        if (err) return console.log(err + " couldn't read the file!");

        manifest = JSON.parse(data);
    });
}

//returns an object containing dependencies of a module (superdependencies)
function getModuleDependencies(moduleMetadata) {
    var dependencies = moduleMetadata.dependencies;
    if (dependencies === undefined) {
        console.log("--- no dependencies found ---")
        return undefined;
    }
    console.log(" --- dependencies of module --- ");
    console.log(Object.keys(dependencies));
    return dependencies;
}


//console.log(isSubset(["dht22" , "logitech_123"], ["dht22", "logitech_123", "networking"] ));
//checks if one set is subset of another
function isSubset(set, subset) {
    if (subset == "") { return false };
    console.log(set);
    console.log("compared to ");
    console.log(subset);

    for (var i in subset) {
        //console.log(i);
        // console.log(set.includes(subset[i]));
        if (!set.includes(subset[i])) {
            console.log(set + " does not include :" + subset[i]);
            return false;
        }

    }
    return true;
    // if(set === subset) {console.log('exact'); return true};
    /* if(!subset.every(isSub)){return false};
     return true;
     function isSub(value){
         return set.includes(value);           
     }*/

}

//handle manifest and matching of interfaces
function digestManifest(manifest, moduleMetadata) {
    if (getObjects(manifest, 'roles', '') != []) {
        console.log("this is a device deployment manifest");
        var manifestRoles = getManifestRoles(manifest);
        var interfaces = getValues(manifestRoles, 'interface');
        var moduleInterfaces = getModuleInterfaces(moduleMetadata);

        //save candidate name with interfaces for later
        if (matchInterfaces(moduleInterfaces, interfaces)) {

            //TODO: check superdependencies
            console.log("found requested interfaces in module")
            fileSystem.appendFile('./files/solutionCandidates.txt', JSON.stringify(moduleMetadata.id) + ' : ' + moduleInterfaces, function (err) {
                if (err) throw err;
                console.log('Candidate module has been saved');
            });
        }
        else return;
    }

    else { console.log("this is something else"); }
}

function getModuleInterfaces(moduleMetadata) {
    return moduleMetadata.interfaces;
}

function getManifestRoles(manifest) {
    return getObjects(manifest, 'interface', '');
}


//checks if all required interfaces are offered by module
function matchInterfaces(moduleInterfaces, manifestInterfaces) {
    console.log(" -- offered interfaces from module -- ")
    console.log(moduleInterfaces);
    console.log(" -- interfaces required -- ")
    console.log(manifestInterfaces);
    var fulfilledInterfaces = 0;
    for (var i in manifestInterfaces) {
        if (moduleInterfaces.includes(manifestInterfaces[i])) {
            fulfilledInterfaces++
            console.log(fulfilledInterfaces);
        }
    }
    if (fulfilledInterfaces == manifestInterfaces.length) {
        console.log("--- manifest interfaces satisfied --- ");
        return true;
    }

    else {
        console.log("--- manifest interfaces not satisfied --- ");
        return false;
    }
}

//returns interfaces from the roles
function getInterfaces(deviceManifest) {
    return getValues(deviceManifest.roles, "interface");
}

function matchRoles(clientManifest, modulemetadata) {
    var clientRoles = getRoles(clientManifest),
        serverRoles = getRoles(modulemetadata);

    if (deepEqual(clientRoles, serverRoles)) {
        console.log(serverRoles);
    }
    else console.log("no match found");

};

function getRoles(manifest) {
    console.log('---- searching for roles ----')
    roles = [];
    //TODO: change to .every
    for (var i in manifest.roles) {
        roles.push(manifest.roles[i]);
        console.log(roles[i]);
    }

    return roles;
}


function getModulemetadata(dirPaths) {
    let startpath = path.join(__dirname, 'modules');
    for (var i in dirPaths) {

        console.log(dirPaths[i]);
        var moduleMetadata;
        var truepath = path.join(startpath, dirPaths[i], 'modulemetadata.json');
        //console.log(truepath);

        //move to separate function for general use
        var moduleMetadata = fileSystem.readFile(truepath, 'utf8', function (err, data) {
            let metadata = data;
            checkModule(JSON.parse(data));

        });

    }

    //handels device description sent by device
    function digestDeviceDescription(manifest, modulemetadata) {
        // console.log(modulemetadata);
        //TODO: handle device description
        var deviceDescription;
        var moduleMetadata;
        deviceDescription = fileSystem.readFile('./files/devicedescription.json', 'UTF-8', function (err, data) {
            if (err) return console.log(err);

            console.log('---- file has been read ----')
            deviceDescription = JSON.parse(data);
            moduleMetadata = modulemetadata;

        });
    }



}

//compares two individual objects for their contents to assert equality
function deepEqual(object1, object2) {
    const keys1 = Object.keys(object1);
    const keys2 = Object.keys(object2);
    if (keys1.length !== keys2.length) {
        return false;
    }
    for (const key of keys1) {
        const val1 = object1[key];
        const val2 = object2[key];
        const areObjects = isObject(val1) && isObject(val2);
        if (
            areObjects && !deepEqual(val1, val2) ||
            !areObjects && val1 !== val2
        ) {
            return false;
        }
    }
    return true;
}


function isObject(object) {
    return object != null && typeof object === 'object';
}


//return an array of objects according to key, value, or key and value matching
function getObjects(obj, key, val) {
    var objects = [];
    for (var i in obj) {
        if (!obj.hasOwnProperty(i)) continue;
        if (typeof obj[i] == 'object') {
            objects = objects.concat(getObjects(obj[i], key, val));
        } else
            //if key matches and value matches or if key matches and value is not passed (eliminating the case where key matches but passed value does not)
            if (i == key && obj[i] == val || i == key && val == '') { //
                objects.push(obj);
            } else if (obj[i] == val && key == '') {
                //only add if the object is not already in the array
                if (objects.lastIndexOf(obj) == -1) {
                    objects.push(obj);
                }
            }
    }
    return objects;
}

//return an array of values that match on a certain key
function getValues(obj, key) {
    var objects = [];
    for (var i in obj) {
        if (!obj.hasOwnProperty(i)) continue;
        if (typeof obj[i] == 'object') {
            objects = objects.concat(getValues(obj[i], key));
        } else if (i == key) {
            objects.push(obj[i]);
        }
    }
    return objects;
}

//return an array of keys that match on a certain value
function getKeys(obj, val) {
    var objects = [];
    for (var i in obj) {
        if (!obj.hasOwnProperty(i)) continue;
        if (typeof obj[i] == 'object') {
            objects = objects.concat(getKeys(obj[i], val));
        } else if (obj[i] == val) {
            objects.push(i);
        }
    }
    return objects;
}


//Looks for matching key: value pairs between stored solutions and manifest
function lookUpKey(key, value) {
    //TODO: Look up keys in a local file to find suitable packages for solution
    for (var candidate in modulemetadata) {
        if (modulemetadata.hasOwnProperty(key)) {

            console.log("found " + key + " with : " + value);
        }
    }
}

   //checks if architecture and peripherals of the module are suitable for the device
/*function checkArchitectureAndPeripherals(deviceDescription, modulemetadata){
    console.log('devicedescription -----');
    console.log(deviceDescription);
    console.log('modulemetadata -----');
    console.log(modulemetadata);
    //checking whether module architecture and peripheral list are satisfactory
    if(deviceDescription.architecture === modulemetadata.architecture 
        && isSubset(deviceDescription.peripherals ,modulemetadata.peripherals)){
            
       console.log("architecture and platform matches!");
        return true;
    }
    return false;
}
*/



