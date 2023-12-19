# This script demonstrates the whole set and execution of the ICWE23 demo
# scenario using the orchestrator CLI client (instead of web-GUI).
#
# NOTE: This script assumes a local installation of compatible version of
# Node.js and you might want to run this inside the orchestrator devcontainer
# instead! (Remember to mount your WebAssembly binaries, descriptions and
# data-files as well!)

if [ $# -lt 1 ]; then
    echo "ARG1: path to a .wasm file of camera required"
    exit 1
elif [ $# -lt 2 ]; then 
    echo "ARG2: path to a .json file of camera description required"
    exit 1
elif [ $# -lt 3 ]; then 
    echo "ARG3: path to a .wasm file of inference required"
    exit 1
elif [ $# -lt 4 ]; then 
    echo "ARG4: path to a .json file of inference description required"
    exit 1
elif [ $# -lt 5 ]; then 
    echo "ARG5: path to a compatible model file for inference required"
    exit 1
fi

# Define variables for the file paths.

campath=$(readlink -f $1)
camdescpath=$(readlink -f $2)
infpath=$(readlink -f $3)
infdescpath=$(readlink -f $4)
infmodelpath=$(readlink -f $5)

campathcontainer=/app/modules/cam.wasm
camdescpathcontainer=/app/modules/cam.json
infpathcontainer=/app/modules/inf.wasm
infdescpathcontainer=/app/modules/inf.json
infmodelpathcontainer=/app/modules/inf.model

set -e

# Start needed containers.
docker-compose up --detach
docker-compose -f docker-compose.example-devices.yml \
    up --detach \
    adequate-webcam-laptop

# Use the client container.
clientcontainername="wasmiot-orcli"
docker build -t $clientcontainername -f client.Dockerfile .

# Inside this script, instead of using alias, define the partial docker command
# as a variable for brevity.
dorcli="docker run \
    --env ORCHESTRATOR_ADDRESS=http://wasmiot-orchestrator:3000 \
    --network=wasmiot-net \
    --volume=$campath:$campathcontainer:ro \
    --volume=$camdescpath:$camdescpathcontainer:ro \
    --volume=$infpath:$infpathcontainer:ro \
    --volume=$infdescpath:$infdescpathcontainer:ro \
    --volume=$infmodelpath:$infmodelpathcontainer:ro \
    $clientcontainername"

# Remove possibly conflicting resources that are there already.
echo "---"
echo "Removing existing conflicting resources..."
$dorcli device rm
$dorcli device scan
$dorcli module rm cam
$dorcli module rm inf
$dorcli deployment rm icwe23-demo
echo "Removal done"
echo "---"

# Create needed camera and inference modules and describe their interfaces.
$dorcli module create cam $campathcontainer
$dorcli module desc cam $camdescpathcontainer
# --||--
$dorcli module create inf $infpathcontainer
$dorcli module desc inf $infdescpathcontainer \
    -m model -p $infmodelpathcontainer

# Create a deployment taking a picture and directing it to inference.
$dorcli deployment create icwe23-demo \
    -d -m cam -f take_image_predefined_path \
    -d -m inf -f infer_predefined_paths

# Install the deployment.
$dorcli deployment deploy icwe23-demo

# Define cleanup if execution succeeds at first try.
cleanup() {
    echo "Example has finished. Composing down..."
    docker-compose down
    docker-compose -f docker-compose.example-devices.yml down
    echo "Done."
}

# Execute. This might definitely fail at first, if the modules needs to be
# compiled at supervisor.
set +e
$dorcli execute icwe23-demo && cleanup

echo
echo "!!!"
echo "Assuming that the execution failed because WebAssembly has not yet finished compiling."

if [ ! -z $6 ]; then
    waittime=$6
else
    waittime=35
fi


# Wait for a while so that the module gets compiled...
for i in $(seq 0 $waittime);
do
    printf "\rWaiting for supervisor to compile wasm... (%2ds)" $(( $waittime - $i ))
    sleep 1
done

echo
echo "Trying to execute again..."
$dorcli execute icwe23-demo || printf "\n!!!\nFailed again. You could try increasing the wait time by passing it as ARG6.\n\n"

cleanup
