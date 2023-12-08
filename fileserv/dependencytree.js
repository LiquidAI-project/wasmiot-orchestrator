const semver = require('semver');
const path = require('path');




const fs = require('fs');

function createPackageDatabase(directoryPath) {
    let packageDatabase = [];

    function traverseDirectory(currentPath) {
        // Read the contents of the current directory
        const contents = fs.readdirSync(currentPath, { withFileTypes: true });

        // Iterate over each item in the directory
        contents.forEach(item => {
            if (item.isDirectory()) {
                // Construct the full path of the current item
                const itemPath = path.join(currentPath, item.name);

                // Check if the folder name follows the package-version pattern
                const match = item.name.match(/^(.*)-(\d+\.\d+\.\d+)$/);
                if (match) {
                    // Add package information to the database
                    packageDatabase.push({
                        name: match[1],
                        version: match[2],
                        path: itemPath
                    });
                } else {
                    // Recursively traverse nested directories
                    traverseDirectory(itemPath);
                }
            }
        });
    }

    traverseDirectory(directoryPath);
    return packageDatabase;
}

// Example usage
const database = createPackageDatabase('./modules');
//test_path = findPackagePath("dht22_logger", "1.0.0", database);
//testNode = createNodeFromMetadata(test_path);
//const dependencyTree = resolveDependenciesWithBacktracking(testNode);
//console.log(JSON.stringify(dependencyTree, null, 2));


function parsePackageName (name, version = "1.0.0") {
    return `${name}-${version}`;
}



function createNodeFromName(nodeName) {
    const [name, version] = nodeName.split('-');
    return createNodeFromMetadata(findPackagePath(name, version, database));
}


/*
Example of requirements
requirements: [
    { name: "dependencyPackage1", version: ">=2.0.0" },
    { name: "dependencyPackage2", version: "^3.1.4" }
*/
const emptyNode = {
    name: "",           // The name of the package
    version: "",        // The version of the package
    requirements: []    // An array of requirements, where each requirement has a name and a version
};



function createDependencyTreeNode(name, version, children = []) {
    return { name, version, children };
}


function findPackagePath(packageName, version, packageDatabase) {
    // Find the package in the database
    const packageEntry = packageDatabase.find(pkg => 
        pkg.name === packageName && pkg.version === version
    );

    // Return the path if the package is found, otherwise return null
    return packageEntry ? packageEntry.path : null;
}



function createNodeFromMetadata(modulePath) {
    // Construct the full path to the modulemetadata.json file
    const metadataFilePath = path.join(modulePath, 'modulemetadata.json');

    try {
        // Read the contents of the file
        const rawData = fs.readFileSync(metadataFilePath, 'utf8');
        
        // Parse the JSON content
        const metadata = JSON.parse(rawData);

        // Construct the node object
        const node = {
            name: metadata.id,
            version: metadata.version,
            requirements: metadata.dependencies.map(dep => {
                const [name, details] = Object.entries(dep)[0];
                return { name, version: details.version };
            })
        };

        return node;
    } catch (error) {
        console.error(`Error reading or parsing module metadata: ${error}`);
        return null;
    }
}




function isVersionCompatible(node, packageRequires) {
    for (const requirement of node.requirements) {
        const packageRequirement = packageRequires.find(req => req.name === requirement.name);

        // If the requirement is not found in packageRequires or the version is not compatible, return false
        if (!packageRequirement || !someVersionCheckFunction(requirement.version, packageRequirement.version)) {
            return false;
        }
    }
    return true;
}

function someVersionCheckFunction(requiredVersion, availableVersion) {
    // Use semver to check if the availableVersion satisfies the requiredVersion
    return semver.satisfies(availableVersion, requiredVersion);
}



function getPackageDetails(packageName, version) {
    // This function should return the package details, including its dependencies,
    // for a given package and version.
    // This is a placeholder implementation.
    return { dependencies: [] };
}

function resolveDependenciesWithBacktracking(node) {
    let resolved = new Set();
    let attempted = new Set();
    let tree = resolveWithBacktracking(node, resolved, attempted);
    return tree;
}

function resolveWithBacktracking(node, resolved, attempted) {
    const nodeKey = `${node.name}@${node.version}`;

    if (resolved.has(nodeKey)) {
        return null;  // Already resolved
    }

    if (attempted.has(nodeKey)) {
        return null;  // Circular dependency detected
    }

    attempted.add(nodeKey);

    let children = [];
    for (let dependency of node.requirements) {
        const availableVersions = getAvailableVersions(dependency.name);
        const compatibleVersion = findCompatibleVersion(dependency.version, availableVersions);

        if (!compatibleVersion) {
            return null;  // No compatible version found
        }

        const dependencyNode = createNodeFromMetadata(findPackagePath(dependency.name, compatibleVersion, database));
        if (!dependencyNode) {
            return null;  // Dependency node couldn't be created
        }

        let child = resolveWithBacktracking(dependencyNode, resolved, attempted);
        if (child) {
            children.push(child);
        }
    }

    resolved.add(nodeKey);
    return createDependencyTreeNode(node.name, node.version, children);
}

function findCompatibleVersion(versionRange, availableVersions) {
    return availableVersions.find(version => semver.satisfies(version, versionRange));
}

function isPackageAvailable(packageName, versionRange, packageDatabase) {
    // Iterate through the package database
    for (const package of packageDatabase) {
        node = package.node;
        // Check if the package name matches and the version is within the specified range
        if (node.name === packageName && semver.satisfies(node.version, versionRange)) {
            return true;
        }
    }
    return false;
}


function getAvailableVersions(packageName, database = null) {
    // If the database is not provided, create it from the './modules' directory
    if (!database) {
        database = createPackageDatabase('./modules');
    }

    // Continue with the rest of the function
    const filteredPackages = database.filter(pkg => pkg.name === packageName);
    const versions = filteredPackages.map(pkg => pkg.version);

    return versions;
}




////////////////////////// TEST CASES //////////////////////////

const testCases = [
    {
        node: {
            name: "packageA",
            version: "1.2.0",
            requirements: [
                { name: "dependency1", version: "^1.0.0" },
                { name: "dependency2", version: ">=2.0.0" }
            ]
        },
        packageRequires: [
            { name: "dependency1", version: "1.1.0" },
            { name: "dependency2", version: "2.5.0" }
        ],
        expected: true,
        description: "Test Case 1: All dependencies are compatible"
    },
    {
        node: {
            name: "packageB",
            version: "2.0.0",
            requirements: [
                { name: "dependency1", version: "^3.0.0" }
            ]
        },
        packageRequires: [
            { name: "dependency1", version: "2.9.0" }
        ],
        expected: false,
        description: "Test Case 2: Incompatible version of dependency1"
    },
    {
        node: {
            name: "packageC",
            version: "3.3.0",
            requirements: []
        },
        packageRequires: [],
        expected: true,
        description: "Test Case 3: No dependencies (always compatible)"
    },
    // Add more test cases as needed
];

// Function to run the test cases
function runTestCases() {
    testCases.forEach((testCase, index) => {
        const result = isVersionCompatible(testCase.node, testCase.packageRequires);
        const pass = result === testCase.expected;
        console.log(`Test Case ${index + 1}: ${testCase.description} - ${pass ? "Pass" : "Fail"}`);
    
    });
    console.log(isPackageAvailable("packageA", "^1.0.0", testCases)); // true
}




// Run the tests
//runTestCases();
