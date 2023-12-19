# This script shows an example of the order of events for using the
# core:Datalist service on a running orchestrator.
# PARAMETERS: $1: A string to use as the entry-data. Defaults to "kissa".


# Set this script to exit on error.
set -e

# Make directory to store temporary response data.
mkdir -p tmp

# Create a deployment by posting a manifest that describes you wanting to use
# the 'push' endpoint. Store the received deployment response containing its ID.
curl http://localhost:3000/file/manifest \
    --fail \
    -X POST \
    --header "Content-Type: application/json" \
    --data '
        {
            "name": "Datalist pusher",
            "sequence": [
                {
                    "device": null,
                    "module": "core:Datalist",
                    "func": "push"
                }
            ]
        }
    ' > tmp/deployment-id.txt
echo ""

# Save the id to variable, removing any surrounding (or contained) quotes.
DEPLOYMENT_ID=$(cat tmp/deployment-id.txt | tr -d '"')

# Deploy, which automatically calls the `_wasmiot_init` function of the module
# that initializes the database document for the module to use from its
# environment (i.e., the MongoDB database).
curl http://localhost:3000/file/manifest/${DEPLOYMENT_ID} --fail -X POST
echo ""

# Now the deployment is ready to use. You can use the manifest-defined 'push'
# endpoint from /execute to add entries to the datalist created at
# deployment-time.

# Perform a couple of pushes. You should see the result in response increasing
# each time.
ENTRY=${1:-"kissa"}
for i in {1..5}; do
    # A file is used for the entry-data to stress the fact that the interface in
    # fact reads incoming files.
    echo $i. $ENTRY > tmp/entry.txt

    # Push a new entry to the datalist.
    curl http://localhost:3000/execute/${DEPLOYMENT_ID} --fail -X POST -F entry=@tmp/entry.txt
    echo ""

    # Wait a while to make sure(r) that the push is complete.
    sleep .2
done