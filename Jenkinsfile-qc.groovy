#!/usr/bin/env groovy

node {
  def TARGET_WEB_NODES = DEVELOPMENT_WEB_NODES


  // Determine set of hosts to run against
  if (ENVIRONMENT.toUpperCase() == 'PRODUCTION') {
    TARGET_WEB_NODES = PRODUCTION_WEB_NODES
  }

  TARGET_WEB_NODES = readJSON text: TARGET_WEB_NODES

  try {
    stage('Setup') {
      cleanWs()

      sh """
        mkdir -p ${WORKSPACE}/qc-results;
        chmod -R 777 ${WORKSPACE}/qc-results;
      """
    }

    stage('Quality Control Checks') {
      def TASKS = [:]

      TARGET_WEB_NODES.each { host ->
        TASKS[host] = {
          sh """
            docker run --rm \
              -v ${WORKSPACE}/qc-results:/hazdev-project/qc-results:rw \
              ${GITLAB_INNERSOURCE_REGISTRY}/ghsc/hazdev/earthquake-design-ws:${IMAGE_VERSION} \
              /bin/bash --login -c 'node qc/smoketest.js https://${host} >> qc-results/${host}.txt'
          """

          publishHTML (target: [
            allowMissing: true,
            alwaysLinkToLastBuild: true,
            keepAll: true,
            reportDir: "${WORKSPACE}/qc-results",
            reportFiles: "${host}.txt",
            reportName: "${host} QC Results"
          ])
        }
      }

      parallel TASKS
    }
  } catch (e) {
    mail to: 'gs-haz_dev_team_group@usgs.gov',
      from: 'noreply@jenkins',
      subject: "Jenkins Failed: ${env.JOB_NAME} [${env.BUILD_NUMBER}]'",
      body: "Project build (${BUILD_TAG}) failed '${e}'"

    currentBuild.result = 'FAILURE'
    throw e
  }
}
