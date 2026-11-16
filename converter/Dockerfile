# Collabify's Word → PDF converter: Gotenberg (LibreOffice), plus
# Microsoft's core fonts (Times New Roman, Arial, Courier New, Georgia, Verdana…)
# so a thesis typed in Times New Roman comes out in Times New Roman, not a look-alike.
# Calibri and Cambria are Office fonts nobody may redistribute; Gotenberg's Carlito
# and Caladea have the same widths, so lines and page breaks still fall where Word puts them.
#
# Built to ghcr.io/lemmuelalinea/collabify-word-pdf by .github/workflows/converter-image.yml;
# runs on Azure Container Apps. See docs/word-pdf-previews.md.

FROM gotenberg/gotenberg:9-libreoffice

LABEL org.opencontainers.image.source=https://github.com/LemmuelAlinea/dyci.collabify
LABEL org.opencontainers.image.description="Collabify Word to PDF converter"

USER root

RUN . /etc/os-release \
 && echo "deb http://deb.debian.org/debian ${VERSION_CODENAME} contrib" > /etc/apt/sources.list.d/contrib.list \
 && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends ttf-mscorefonts-installer \
 && fc-cache -f \
 && fc-list | grep -qi "Times New Roman" \
 && rm -rf /var/lib/apt/lists/*

USER gotenberg
