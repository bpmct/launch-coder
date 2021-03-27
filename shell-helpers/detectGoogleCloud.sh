# thanks https://stackoverflow.com/a/38795846/10850488

GMETADATA_ADDR=`dig +short metadata.google.internal`
if [[ "${GMETADATA_ADDR}" == "" ]]; then
    echo false
else
    echo true
fi