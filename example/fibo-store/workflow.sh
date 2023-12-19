# NOTE: You need to have a supervisor running for this example to work!

# This script shows an example of the order of events for using the
# core:Datalist service on a running orchestrator to store fibonacci results
# that in turn run on a supervisor.


# Set this script to exit on error.
set -e

# Make directory to store temporary response data.
mkdir -p tmp

# Create the Math module TODO.

# Create a deployment by posting a manifest that describes you wanting to use
# the 'push' endpoint from 'core:Datalist' and 'fibo' from 'Math'. Store the
# received deployment response containing its ID.
curl http://localhost:3000/file/manifest \
    --fail \
    -X POST \
    --header "Content-Type: application/json" \
    --data '
        {
            "name": "Fibo store",
            "sequence": [
                {
                    "device": null,
                    "module": "Math",
                    "func": "fibo"
                },
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

# Deploy, which automatically calls the `_wasmiot_init` function of the
# core:Datalist module that initializes the database document for the module to
# use from its environment (i.e., the MongoDB database). This call also requests
# the chosen _supervisor_ to set up the Math module on itself.
curl http://localhost:3000/file/manifest/${DEPLOYMENT_ID} --fail -X POST
echo ""

# Now the deployment is ready to use. You can use the 'fibo' endpoint from
# /execute to count fibonacci numbers which get piped according to the above
# manifest to datalist created at deployment-time.

# Perform a couple of pushes. You should see the result in response increasing
# each time (i.e., the last item in list is the result of the last fibo-call).
NUM=${1:-7}
for i in {0..4}; do
    INNUM=$(($NUM + $i))
    echo "fibonacci(${INNUM})"

    # Push a new entry to the datalist.
    curl http://localhost:3000/execute/${DEPLOYMENT_ID} \
        --fail \
        -X POST \
        --header "Content-Type: application/json" \
        --data '{"param0":'${INNUM}'}'

    echo ""

    # Wait a while to make sure(r) that the push is complete.
    sleep .2
done
