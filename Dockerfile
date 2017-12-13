FROM alpine

ARG APGDIFF_VERSION
ENV TZ=Europe/Berlin
ENV PATH=/usr/local/bin:$PATH

    
RUN echo "installing dependencies" \
    && echo '@edge http://dl-cdn.alpinelinux.org/alpine/edge/main' >> /etc/apk/repositories \
    && echo '@edge http://dl-cdn.alpinelinux.org/alpine/edge/community' >> /etc/apk/repositories \
    && echo '@edge http://dl-cdn.alpinelinux.org/alpine/edge/testing' >> /etc/apk/repositories \
    && apk update \
    && apk add --no-cache --virtual .build-deps \
        build-base perl-dev gnupg curl ca-certificates wget \

    && update-ca-certificates \

    && apk add --update --no-cache \
        git \
        tzdata \
        postgresql-client@edge postgresql-dev@edge \
        perl \
        openjdk8-jre \
        nodejs nodejs-npm \

    && curl -L https://cpanmin.us | perl - App::cpanminus \
    && cpanm --verbose --no-interactive --no-man-pages --notest DBD::Pg App::Sqitch \

    && cd /tmp \
    && curl -OSL https://github.com/subzerocloud/apgdiff/releases/download/${APGDIFF_VERSION}-subzero/apgdiff-${APGDIFF_VERSION}-subzero.jar \
    && mv apgdiff-${APGDIFF_VERSION}-subzero.jar /usr/local/bin/apgdiff.jar \
    
    && apk del .build-deps

VOLUME ["/src"]
WORKDIR /src


