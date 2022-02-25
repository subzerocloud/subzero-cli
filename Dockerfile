FROM postgres:13-alpine

ARG APGDIFF_VERSION=2.6.7
ARG WORKBENCH_VERSION=127
ENV TZ=Europe/Berlin
ENV PATH=/usr/local/bin:$PATH

    
RUN echo "installing dependencies" \
    && set -x \
    && apk update \
    && apk add --no-cache bash coreutils python3 cmd:pip3 ca-certificates \
    && update-ca-certificates \
    && apk add --no-cache --virtual .build-deps \
        build-base perl-dev gnupg curl wget python3-dev \
    && apk add --update --no-cache \
        git \
        tzdata \
        perl \
        openjdk8-jre \
        nodejs npm \
    && cd /tmp \
    && curl -OSL https://github.com/subzerocloud/apgdiff/releases/download/${APGDIFF_VERSION}-subzero/apgdiff-${APGDIFF_VERSION}-subzero.jar \
    && mv apgdiff-${APGDIFF_VERSION}-subzero.jar /usr/local/bin/apgdiff.jar \
    && curl -sSL https://jdbc.postgresql.org/download/postgresql-42.2.18.jar \
		 -o postgresql-42.2.18.jar \
	&& mv postgresql-42.2.18.jar /usr/local/lib/ \
    && curl -OSL https://www.sql-workbench.eu/Workbench-Build${WORKBENCH_VERSION}.zip \
    && mkdir -p /workbench && unzip Workbench-Build${WORKBENCH_VERSION}.zip -d /workbench \
    && pip3 install --upgrade --no-cache-dir pip\
    && pip3 install --no-cache-dir psycopg2-binary migra\
    && curl -L https://cpanmin.us | perl - App::cpanminus \
    && cpanm --verbose --no-interactive --no-man-pages --notest DBD::Pg App::Sqitch \
    && apk del .build-deps python3-dev \
    rm -rf /tmp/* /var/tmp/* /var/cache/apk/*

VOLUME ["/src"]
WORKDIR /src


