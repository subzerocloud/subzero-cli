#!/bin/bash
# BASEDIR=`realpath $(dirname $(realpath $0))/../`
BASEDIR=/project
source $BASEDIR/.env
STYLE=${1:monokai}
docker logs -f ${COMPOSE_PROJECT_NAME}_db_1 2>&1 | pygmentize -O style=${STYLE} -l postgresql  -f 256 -s