#!/bin/bash
#BASEDIR=`realpath $(dirname $(realpath $0))/../`
BASEDIR=/project
source $BASEDIR/.env

docker logs -f ${COMPOSE_PROJECT_NAME}_rabbitmq_1 2>&1
