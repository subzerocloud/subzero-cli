FROM debian:jessie


ENV DOCKER_BUCKET get.docker.com
ENV DOCKER_VERSION 1.13.0
ENV DOCKER_SHA256 fc194bb95640b1396283e5b23b5ff9d1b69a5e418b5b3d774f303a7642162ad6

# ENV PG_MAJOR 9.6
# ENV PG_VERSION 9.6.1-2.pgdg80+1
# RUN set -ex; \
# # pub   4096R/ACCC4CF8 2011-10-13 [expires: 2019-07-02]
# #       Key fingerprint = B97B 0AFC AA1A 47F0 44F2  44A0 7FCC 7D46 ACCC 4CF8
# # uid                  PostgreSQL Debian Repository
# 	key='B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8'; \
# 	export GNUPGHOME="$(mktemp -d)"; \
# 	gpg --keyserver ha.pool.sks-keyservers.net --recv-keys "$key"; \
# 	gpg --export "$key" > /etc/apt/trusted.gpg.d/postgres.gpg; \
# 	rm -r "$GNUPGHOME"; \
# 	apt-key list
# RUN echo 'deb http://apt.postgresql.org/pub/repos/apt/ jessie-pgdg main' $PG_MAJOR > /etc/apt/sources.list.d/pgdg.list


# Install dependencies
RUN apt-get update \
	&& apt-get install -y postgresql-client build-essential ccze python-pip wget mc \
	&& pip install Pygments \
	&& wget -q https://github.com/emcrisostomo/fswatch/releases/download/1.9.3/fswatch-1.9.3.tar.gz \
	&& tar -zxf fswatch-1.9.3.tar.gz \
	&& cd fswatch-1.9.3 \
	&& ./configure && make && make install \
	&& ldconfig \
	&& cd ../ && rm -Rf fswatch-1.9.3 && rm fswatch-1.9.3.tar.gz \
	&& set -x \
	&& wget -q "https://${DOCKER_BUCKET}/builds/Linux/x86_64/docker-${DOCKER_VERSION}.tgz" -O docker.tgz \
	&& echo "${DOCKER_SHA256} *docker.tgz" | sha256sum -c - \
	&& tar -xzvf docker.tgz \
	&& mv docker/* /usr/local/bin/ \
	&& rmdir docker \
	&& rm docker.tgz \
	&& docker -v
RUN	apt-get remove -y build-essential \
	&& apt-get autoremove -y \
	&& apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*



COPY bin /usr/local/bin
COPY docker-entrypoint.sh /usr/local/bin/

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bash"]

# build with
# docker build --no-cache -t sub0/devtools .
# docker build -t sub0/devtools .

# run with
# ( source $(pwd)/.env; docker run -v /var/run/docker.sock:/var/run/docker.sock -v $(pwd):/project -l ${COMPOSE_PROJECT_NAME}_db_1:db --network ${COMPOSE_PROJECT_NAME}_default -ti sub0/devtools )
# alias sub0='function _sub0(){ source $(pwd)/.env; docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v $(pwd):/project -l ${COMPOSE_PROJECT_NAME}_db_1:db --network ${COMPOSE_PROJECT_NAME}_default -ti sub0/devtools $@; };_sub0'
