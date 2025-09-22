# Team Hierarchy

This diagram shows the hierarchical structure of teams in the **elastic** organization. Parent teams are connected to their child teams with arrows.

## Diagram

```mermaid
graph TD
t_employees["Employees"]
t_pre-sales["Pre-Sales"]
t_product-vulnerability-response["product-vulnerability-response"]
t_beats-contributors["beats-contributors"]
t_infra["Infra"]
t_deprecated-continuous-integration["[deprecated] Continuous Integration"]
t_microsoft["microsoft"]
t_es-clients["es-clients"]
t_webteam["webteam"]
t_support-ops-automation["support-ops-automation"]
t_cloud-team["cloud-team"]
t_business-systems["Business Systems"]
t_machine-learning["machine-learning"]
t_cloud-sre["cloud-sre"]
t_support["support"]
t_demandegen["Demandegen"]
t_docs["docs"]
t_elasticsearch-team["elasticsearch-team"]
t_logstash["logstash"]
t_education["education"]
t_services["services"]
t_design["Design"]
t_product-team["Product-team"]
t_external["External"]
t_training-ops["training-ops"]
t_apm["APM"]
t_kibana-core["kibana-core"]
t_kibana-design["kibana-design"]
t_kibana-operations["kibana-operations"]
t_stack-monitoring["stack-monitoring"]
t_cloud-security["cloud-security"]
t_revtech-eng["revtech-eng"]
t_support-managers["Support Managers"]
t_cloud-area-leads["cloud-area-leads"]
t_apm-ui["APM UI"]
t_security-attention["Security-Attention"]
t_legal["Legal"]
t_eui-team["eui-team"]
t_ece-experts["ece-experts"]
t_community["Community"]
t_apm-agent-devs["APM agent devs"]
t_apm-server["APM Server"]
t_es-search["es-search"]
t_es-core-infra["es-core-infra"]
t_es-distributed-obsolete["es-distributed-obsolete"]
t_es-security["es-security"]
t_es-ql["es-ql"]
t_swiftype-sre["swiftype-sre"]
t_cloud-pms["cloud-pms"]
t_kibana-security["kibana-security"]
t_cloud-ui["cloud-ui"]
t_infosec["Infosec"]
t_video["Video"]
t_code-of-conduct["Code of Conduct"]
t_cloud-sre-emea["cloud-sre-emea"]
t_cloud-sre-nasa["cloud-sre-nasa"]
t_cloud-sre-apj["cloud-sre-apj"]
t_content-admins["content-admins"]
t_website-admins["website-admins"]
t_ml-core["ml-core"]
t_ml-ui["ml-ui"]
t_es-docs["es-docs"]
t_cloud-qa["cloud-qa"]
t_kibana-presentation["kibana-presentation"]
t_kibana-gis["kibana-gis"]
t_kibana-qa["kibana-qa"]
t_cloud-sre-leads["cloud-sre-leads"]
t_cloud-observability["cloud-observability"]
t_platform-writers["platform-writers"]
t_code["code"]
t_marketing-admin["marketing-admin"]
t_podcasters["podcasters"]
t_ml-pm["ml-pm"]
t_seceng["seceng"]
t_cloud-tooling["Cloud Tooling"]
t_style-guide-admin["style-guide-admin"]
t_test-team-trc["test-team-trc"]
t_siem["SIEM"]
t_east-sa["east-sa"]
t_infra-monitoring-ui["Infra Monitoring UI"]
t_enterprise-search["enterprise-search"]
t_es-data-management["es-data-management"]
t_es-analytics-geo["es-analytics-geo"]
t_integrations["integrations"]
t_uptime["uptime"]
t_kibana-management["kibana-management"]
t_observability["observability"]
t_observability-pm["observability-pm"]
t_dotnet["dotnet"]
t_beats["beats"]
t_experience-docs["experience-docs"]
t_cloud-fedramp["cloud-fedramp"]
t_cloud-infra["cloud-infra"]
t_ecs["ecs"]
t_kibana-test-triage["kibana-test-triage"]
t_kibana-expressions["kibana-expressions"]
t_elasticsearch-pm["elasticsearch-pm"]
t_appex-qa["appex-qa"]
t_cloud-release-managers["cloud-release-managers"]
t_french["french"]
t_kibana-app-services["kibana-app-services"]
t_support-tech-leads["support-tech-leads"]
t_cloud-stack-n-soln["cloud-stack-n-soln"]
t_marketing-analytics["marketing-analytics"]
t_cloud-orchestration["cloud-orchestration"]
t_observablt-robots["observablt-robots"]
t_control-plane-ingress["control-plane-ingress"]
t_observability-design["observability-design"]
t_telemetry["telemetry"]
t_partners["Partners"]
t_platform-billing["platform-billing"]
t_csm["CSM"]
t_cloud-k8s["cloud-k8s"]
t_observability-leads["observability-leads"]
t_pmm-team-admins["PMM Team Admins"]
t_mops["mops"]
t_elastic-charts["elastic-charts"]
t_mktg-release["mktg-release"]
t_kibana-pm["kibana-pm"]
t_final-content-review["final-content-review"]
t_infra-telemetry["infra-telemetry"]
t_ci-systems["ci-systems"]
t_release-eng["release-eng"]
t_endpoint-response["endpoint-response"]
t_security-onboarding-and-lifecycle-mgt["security-onboarding-and-lifecycle-mgt"]
t_endpoint-data-visibility-team["endpoint data visibility team"]
t_ml-docs["ml-docs"]
t_ecs-logging["ecs-logging"]
t_protections["Protections"]
t_security-ml["Security ML"]
t_security-data-engineering["Security Data Engineering"]
t_security-intelligence-analytics["Security Intelligence & Analytics"]
t_endgame["Endgame"]
t_elastic-endpoint["elastic-endpoint"]
t_salt["SALT"]
t_devtools-team["devtools-team"]
t_protections-leads["protections-leads"]
t_perched["Perched"]
t_cloud-journey["cloud-journey"]
t_cloud-delivery["cloud-delivery"]
t_portuguese["portuguese"]
t_kibana-telemetry["Kibana telemetry"]
t_security-sre["security-sre"]
t_kibana-reporting-services["kibana-reporting-services"]
t_kibana-localization["kibana-localization"]
t_infra-hosting["infra-hosting"]
t_endpoint-protections["Endpoint Protections"]
t_endpoint["Endpoint"]
t_endpoint-qa["Endpoint QA"]
t_egs-github-users["egs-github-users"]
t_egs-engineering-internal["egs-engineering-internal"]
t_egs-research-internal["egs-research-internal"]
t_endpoint-jenkins-cicd-admin["Endpoint Jenkins CICD Admin"]
t_egs-smp-internal["egs-smp-internal"]
t_egs-it["egs-it"]
t_malwarescore["MalwareScore"]
t_egs-qa-internal["egs-qa-internal"]
t_endgame-sre["Endgame SRE"]
t_eql-rules-developers["EQL Rules Developers"]
t_cloud-team-tech-leads["cloud-team-tech-leads"]
t_it-engineering["IT Engineering"]
t_security-design["security-design"]
t_egs-qa-source-external["egs-qa-source-external"]
t_usability-guild["usability-guild"]
t_integrations-services["integrations-services"]
t_integrations-platforms["integrations-platforms"]
t_cloud-customer-comms-godaddy["cloud-customer-comms-godaddy"]
t_cloud-customer-comms-riot["cloud-customer-comms-riot"]
t_cloud-customer-comms-watson["cloud-customer-comms-watson"]
t_cloud-customer-comms-instacart["cloud-customer-comms-instacart"]
t_endpoint-cs["endpoint-cs"]
t_es-perf["es-perf"]
t_dream-machine["dream-machine"]
t_siem-security-team["siem-security-team"]
t_licensing-portal["licensing-portal"]
t_endpoint-app-team["Endpoint App Team"]
t_devops["devops"]
t_marti["MARTI"]
t_research-and-development["Research and Development"]
t_egs-qasource["egs-qasource"]
t_observability-security-team["observability-security-team"]
t_vulnerabilities-elasticsearch["vulnerabilities-elasticsearch"]
t_datavis["datavis"]
t_o11y-pmm["o11y-pmm"]
t_lego-consulting-team["lego-consulting-team"]
t_mktg-release-cc["Mktg-release-CC"]
t_cloud-analytics["cloud-analytics"]
t_curriculum-dev["curriculum-dev"]
t_support-matrix["support-matrix"]
t_estf-eck["estf-eck"]
t_estf-ece["estf-ece"]
t_estf-ess["estf-ess"]
t_estf-stack["estf-stack"]
t_estf-users["estf-users"]
t_enterprisesearch-vulnerabilities["enterprisesearch-vulnerabilities"]
t_endpoint-test-infra["endpoint-test-infra"]
t_apm-agent-java["APM Agent Java"]
t_cloud-customer-comms-rappi["cloud-customer-comms-rappi"]
t_image-creators["image-creators"]
t_crm-team["CRM Team"]
t_apm-agent-ruby["APM Agent Ruby"]
t_apm-agent-go["APM Agent Go"]
t_apm-agent-python["APM Agent Python"]
t_apm-agent-node-js["APM Agent Node.js"]
t_apm-agent-php["APM Agent PHP"]
t_apm-agent-net["APM Agent .NET"]
t_apm-agent-rum["APM Agent RUM"]
t_security-pmm["security-pmm"]
t_cloud-pmm["cloud-pmm"]
t_stack-pmm["stack-pmm"]
t_cloud-reliability["cloud-reliability"]
t_newsfeed["newsfeed"]
t_gpg-signers["gpg-signers"]
t_final-customer-advocacy-review["Final Customer Advocacy Review"]
t_search-design["search-design"]
t_obs-docs["obs-docs"]
t_observability-ui["Observability UI"]
t_security-docs["security-docs"]
t_services-delivery["services-delivery"]
t_education-contributors["education-contributors"]
t_cloudtrials-dg["cloudtrials-dg"]
t_security-external-integrations["security-external-integrations"]
t_risk-management["Risk Management"]
t_governance["Governance"]
t_detection["Detection"]
t_threat-intel["Threat Intel"]
t_incident-response["Incident Response"]
t_infosec-security-assurance["InfoSec Security Assurance"]
t_product-security["Product Security"]
t_apm-pm["apm-pm"]
t_platform-design["platform-design"]
t_business-systems-external["Business Systems External"]
t_cloud-guests["cloud-guests"]
t_regional-demand-generation["Regional Demand Generation"]
t_ml-rd["ml-rd"]
t_it-data-integrations["IT Data Integrations"]
t_it-finance-systems["IT Finance Systems"]
t_it-custom-apps["IT Custom Apps"]
t_it-qa-automation["IT QA Automation"]
t_it-operations-eng-admins["IT Operations Eng Admins"]
t_apple-signers["apple-signers"]
t_kibana-accessibility["kibana-accessibility"]
t_es-delivery["es-delivery"]
t_security-detections-response["security-detections-response"]
t_internal-audit-sox["internal-audit-sox"]
t_eql-committee["eql-committee"]
t_ingest-fp["ingest-fp"]
t_elastic-agent["Elastic-Agent"]
t_fleet["fleet"]
t_apm-agent-ios["APM Agent iOS"]
t_elastic-endgame["Elastic Endgame"]
t_data-collection-qa["data-collection-qa"]
t_data-collection-qa-external["data-collection-qa-external"]
t_search-leads["Search Leads"]
t_security-solution["security-solution"]
t_security-threat-hunting["security-threat-hunting"]
t_security-threat-intelligence["security-threat-intelligence"]
t_security-engineering-productivity["security-engineering-productivity"]
t_es-leads["es-leads"]
t_security-asset-management["Security Asset Management"]
t_contractors-marketing["contractors-marketing"]
t_contractors-cloud["contractors-cloud"]
t_external-contractors["External Contractors"]
t_fleet-qasource-external["fleet-qasource-external"]
t_download-stats-dev["download-stats-dev"]
t_docs-engineering["docs-engineering"]
t_csr["csr"]
t_csg-services-arb["csg-services-arb"]
t_product-designers["product-designers"]
t_observability-rac["Observability RAC"]
t_ecosystem["ecosystem"]
t_cloud-billing-contractors["cloud-billing-contractors"]
t_elastic-ansible["elastic-ansible"]
t_kibana-tech-leads["kibana-tech-leads"]
t_cloud-applications-es["cloud-applications-es"]
t_cloud-applications-solutions["cloud-applications-solutions"]
t_infra-spaceforce["infra-spaceforce"]
t_services-partners-delivery["Services-Partners-Delivery"]
t_consulting["consulting"]
t_kibana-data-discovery["kibana-data-discovery"]
t_kibana-visualizations["kibana-visualizations"]
t_control-plane-iam["control-plane-iam"]
t_control-plane-data-services["control-plane-data-services"]
t_search-eng["search-eng"]
t_unified-integration["unified-integration"]
t_elastic-agent-data-plane["Elastic Agent Data Plane"]
t_elastic-agent-control-plane["Elastic Agent Control Plane"]
t_security-detection-rule-management["security-detection-rule-management"]
t_observablt-robots-contractors["observablt-robots-contractors"]
t_crm-qa["CRM-QA"]
t_security-solution-platform["security-solution-platform"]
t_security-data-analytics["security-data-analytics"]
t_web-launches["web-launches"]
t_unified-observability["unified-observability"]
t_actionable-observability["actionable-observability"]
t_pme["pme"]
t_kibana-visualizations-external["kibana-visualizations-external"]
t_cloud-security-posture["cloud-security-posture"]
t_profiling["profiling"]
t_platform-capacity["platform-capacity"]
t_kibana-graph["kibana-graph"]
t_security-detections-response-alerts["security-detections-response-alerts"]
t_localization["Localization"]
t_es-perf-contractors["es-perf-contractors"]
t_profiling-contractors["profiling-contractors"]
t_search-experiences-team["search-experiences-team"]
t_eck-region["eck-region"]
t_response-ops-execution["response-ops-execution"]
t_response-ops-ram["response-ops-ram"]
t_response-ops["response-ops"]
t_open-source-wg["open-source-wg"]
t_platform-deployment-monitoring["platform-deployment-monitoring"]
t_platform["platform"]
t_sre["sre"]
t_infra-sre["infra-sre"]
t_infra-foundations["infra-foundations"]
t_infra-services["infra-services"]
t_infra-systems["infra-systems"]
t_platform-analytics["platform-analytics"]
t_obs-cloud-monitoring["obs-cloud-monitoring"]
t_obs-cloudnative-monitoring["obs-cloudnative-monitoring"]
t_global-ux["global-ux"]
t_okta_mappings["okta_mappings"]
t_it-di-approval["It-di-approval"]
t_it-di-dev["it-di-dev"]
t_breaking-changes-committee["Breaking Changes Committee"]
t_cloud-writers["cloud-writers"]
t_obs-service-integrations["obs-service-integrations"]
t_security-threat-hunting-explore["security-threat-hunting-explore"]
t_security-threat-hunting-investigations["security-threat-hunting-investigations"]
t_mlr-docs["mlr-docs"]
t_cloudbeat["cloudbeat"]
t_ce-edu-team["ce-edu-team"]
t_cloud-contractors["cloud-contractors"]
t_kibana-cloud-security-posture["kibana-cloud-security-posture"]
t_infra-systems-network["infra-systems-network"]
t_platform-productivity-engineering["Platform Productivity Engineering"]
t_threat-research-and-detection-engineering["Threat Research and Detection Engineering"]
t_infra-systems-puppet["infra-systems-puppet"]
t_elastic-agent-release["elastic-agent-release"]
t_purple-kittens-dev["purple-kittens-dev"]
t_purple-kittens-instructors["purple-kittens-instructors"]
t_infosec-readers["infosec-readers"]
t_threat-intelligence-research["Threat Intelligence Research"]
t_apm-leads["apm-leads"]
t_malware-analysis-and-reverse-engineering["Malware Analysis and Reverse Engineering"]
t_exalate-administrators["exalate-administrators"]
t_control-plane-applications["control-plane-applications"]
t_apm-agent-android["APM Agent Android"]
t_amer-fed-consulting-team["amer-fed-consulting-team"]
t_it-data-integrations-admins["it-data-integrations-admins"]
t_csp-security-policies["csp-security-policies"]
t_ea["ea"]
t_certification-admins["certification-admins"]
t_protections-experience["Protections Experience"]
t_security-design-frameworks["security-design-frameworks"]
t_platform-onboarding["platform-onboarding"]
t_kibana-performance-testing["kibana-performance-testing"]
t_developer-experience["developer-experience"]
t_cloud-k8s-operator["cloud-k8s-operator"]
t_cloud-k8s-region["cloud-k8s-region"]
t_csp-automation["csp-automation"]
t_ux-writers["ux-writers"]
t_csp-ops["csp-ops"]
t_response-ops-pm["response-ops-pm"]
t_k8smd-codeowners["k8smd-codeowners"]
t_supply-chain-work-group["supply-chain-work-group"]
t_platform-marketplaces["platform-marketplaces"]
t_observablt-ci["observablt-ci"]
t_observablt-dx["observablt-dx"]
t_observablt-pf["observablt-pf"]
t_profiling-ui["profiling-ui"]
t_threat-data-services["Threat Data Services"]
t_security-external-integrations-crest["security-external-integrations-crest"]
t_crest-contributors["Crest-Contributors"]
t_engineering-productivity-admins["engineering-productivity-admins"]
t_biztech["biztech"]
t_platform-observability-sre["platform-observability-sre"]
t_au-newjoiner["au-newjoiner"]
t_infosec-enablement["InfoSec Enablement"]
t_platform-security["platform-security"]
t_infosec-delivery["InfoSec Delivery"]
t_mare-team["mare-team"]
t_elasticsearch-esql["elasticsearch-esql"]
t_zaas-team["zaas-team"]
t_fed-services-contractors["fed-services-contractors"]
t_obs-integration-contractors["obs-integration-contractors"]
t_appex-sharedux["appex-sharedux"]
t_platform-qx["platform-qx"]
t_platform-billing-runners["platform-billing-runners"]
t_support-knowledge-leads["support-knowledge-leads"]
t_ems["ems"]
t_cloud-revenue-team["Cloud Revenue Team"]
t_infra-mki["infra-mki"]
t_consulting-emea["consulting-emea"]
t_security-defend-workflows["security-defend-workflows"]
t_csg-services-admins["csg-services-admins"]
t_elastic-security-labs["Elastic Security Labs"]
t_control-plane-stateful["Control Plane Stateful"]
t_control-plane-stateful-foundations["Control Plane Stateful Foundations"]
t_control-plane-hosted-applications["Control Plane Hosted Applications"]
t_sec-applied-ml["sec-applied-ml"]
t_sec-ml-ops["sec-ml-ops"]
t_control-plane-team-leads["control-plane-team-leads"]
t_ingest-docs["ingest-docs"]
t_serverless-core["Serverless Core"]
t_control-plane-serverless["Control Plane Serverless"]
t_platform-billing-engineers["platform-billing-engineers"]
t_ingest-tech-lead["Ingest-tech-lead"]
t_idea["idea"]
t_serverless-ui["Serverless UI"]
t_app-obs["app obs"]
t_ecp-services["ECP Services"]
t_observability-asset-management["Observability Asset Management"]
t_control-plane-snyk-responders["control-plane-snyk-responders"]
t_docs-build-guild["docs-build-guild"]
t_trustedsec-contractors["trustedsec-contractors"]
t_purple-kittens-automation["purple-kittens-automation"]
t_platform-tooling-bots["platform-tooling-bots"]
t_endpoint-ci-admin["endpoint-ci-admin"]
t_security-detection-engine["security-detection-engine"]
t_security-tech-leads["security-tech-leads"]
t_obs-infraobs-integrations["obs-infraobs-integrations"]
t_protections-artifact-release-approvers["protections-artifact-release-approvers"]
t_fleet-security-triage["fleet-security-triage"]
t_beats-tech-leads["Beats Tech Leads"]
t_serverless-applications["Serverless Applications"]
t_ingest-eng-prod["ingest-eng-prod"]
t_endgame-sec["endgame-sec"]
t_endpoint-snyk-responders["endpoint-snyk-responders"]
t_doc-leads["doc-leads"]
t_obs-bi-team["obs-bi-team"]
t_sec-linux-platform["sec-linux-platform"]
t_search-relevance["search-relevance"]
t_search-productivity-team["Search Productivity Team"]
t_obs-ai-assistant["obs-ai-assistant"]
t_search-ux["Search UX"]
t_infosec-contractors["Infosec Contractors"]
t_elasticsearch-labs-reviewers["Elasticsearch Labs Reviewers"]
t_we45contractors["we45contractors"]
t_es-esql["es-esql"]
t_search-labs-maintainers["Search Labs Maintainers"]
t_ce["ce"]
t_kibana-release-operators["kibana-release-operators"]
t_sec-cloudnative-integrations["sec-cloudnative-integrations"]
t_platform-docs["platform-docs"]
t_control-plane-serverless-leads["control-plane-serverless-leads"]
t_platform-analytics-indexing["platform-analytics-indexing"]
t_ux["UX"]
t_salesgpt-admins["salesgpt-admins"]
t_salesgpt-core-team["salesgpt-core-team"]
t_salesgpt-all-members["salesgpt-all-members"]
t_contentstack-expert-services["Contentstack Expert Services"]
t_elastic-brand-microsite-team["Elastic brand microsite team"]
t_security-entity-analytics["security-entity-analytics"]
t_obs-ux-logs-team["obs-ux-logs-team"]
t_obs-ux-management-team["obs-ux-management-team"]
t_endgame-nin3["Endgame Nin3"]
t_obs-knowledge-team["obs-knowledge-team"]
t_obs-ux-infra_services-team["obs-ux-infra_services-team"]
t_tooling-qasource["tooling-qasource"]
t_eng-prod-engagement-team["eng-prod-engagement-team"]
t_ux-writing-leads["ux-writing-leads"]
t_apm-agent-approvers["apm-agent-approvers"]
t_integration-docs["integration-docs"]
t_it-integrations-contractors["it-integrations-contractors"]
t_observablt-robots-automation["observablt-robots-automation"]
t_sales-insights["Sales Insights"]
t_docs-stack-release-team["docs-stack-release-team"]
t_search-docs["search-docs"]
t_obs-ds-hosted-services["obs-ds-hosted-services"]
t_obs-ds-hosted-services-synthrum["obs-ds-hosted-services-synthrum"]
t_opentelemetry-leads["OpenTelemetry leads"]
t_opentelemetry-program-team["OpenTelemetry Program Team"]
t_esenmarti-test1["esenmarti-test1"]
t_esenmarti-test2["esenmarti-test2"]
t_docs-repo-owners["docs-repo-owners"]
t_security-solution-test-skippers["security-solution-test-skippers"]
t_apj-consulting["apj-consulting"]
t_terraform-providers-admins["Terraform Providers Admins"]
t_opex["opex"]
t_es-analytical-engine["es-analytical-engine"]
t_es-storage-engine["es-storage-engine"]
t_customer-architects["customer-architects"]
t_opex-devops["opex-devops"]
t_opex-front["opex-front"]
t_opex-back["opex-back"]
t_security-entity-analytics-qa["security-entity-analytics-qa"]
t_obs-ds-intake-services["obs-ds-intake-services"]
t_ga-admin["ga-admin"]
t_csg-data-team["csg-data-team"]
t_security-service-integrations["security-service-integrations"]
t_security-integrations-operations-infrastructure["security-integrations operations-infrastructure"]
t_security-integrations-operations-data-analytics["security-integrations-operations-data-analytics"]
t_security-integrations-operations["security-integrations-operations"]
t_security-scalability["security-scalability"]
t_sec-deployment-and-devices["sec-deployment-and-devices"]
t_sec-windows-platform["sec-windows-platform"]
t_obs-ds-edge-collection["obs-ds-edge-collection"]
t_ingest-otel-data["ingest-otel-data"]
t_accessibilitycontractors["AccessibilityContractors"]
t_security-generative-ai["Security Generative AI"]
t_customer-architect["customer-architect"]
t_customerarchitect["customerarchitect"]
t_field-admin["field-admin"]
t_marketing-mktg-admin["marketing-mktg-admin"]
t_support-admin["support-admin"]
t_security-edge-integrations["security-edge-integrations"]
t_sre-resilience["sre-resilience"]
t_purple-kittens-command["purple-kittens-command"]
t_engineering-appex-admin["engineering-appex-admin"]
t_engineering-ingest-admin["engineering-ingest-admin"]
t_engineering-sre-admin["engineering-sre-admin"]
t_engineering-search-admin["engineering-search-admin"]
t_engineering-obs-admin["engineering-obs-admin"]
t_engineering-security-admin["engineering-security-admin"]
t_engineering-infosec-admin["engineering-infosec-admin"]
t_engineering-community-admin["engineering-community-admin"]
t_engineering-pf-billing-admin["engineering-pf-billing-admin"]
t_engineering-controlplane-admin["engineering-controlplane-admin"]
t_engineering-elasticsearch-admin["engineering-elasticsearch-admin"]
t_engineering-engprod-admin["engineering-engprod-admin"]
t_platform-billing-ws-marketplaces["platform-billing-ws-marketplaces"]
t_ga-it-admin["ga-it-admin"]
t_platform-dev-flow["platform-dev-flow"]
t_software-supply-chain-security-team["software-supply-chain-security-team"]
t_eco["eco"]
t_global_sa_team["global_sa_team"]
t_productivity-foundations["Productivity Foundations"]
t_genomelab["genomelab"]
t_kibana-esql["kibana-esql"]
t_elasticgpt["elasticgpt"]
t_app-search-team["app-search-team"]
t_esenmarti-group-test["esenmarti-group-test"]
t_platform-eng-prod["platform-eng-prod"]
t_platform-eng-prod-eng-leads["platform-eng-prod-eng-leads"]
t_opex-support["opex-support"]
t_kibana-incident-responders["kibana-incident-responders"]
t_platform-billing-bm["platform-billing-bm"]
t_response-ops-management-experiences["response-ops-management-experiences"]
t_platform-eng-prod-leads["platform-eng-prod-leads"]
t_obs-experience-team["obs-experience-team"]
t_obs-ux-team["obs-ux-team"]
t_yaas["yaas"]
t_obs-ds-ebpf-research["obs-ds-ebpf-research"]
t_cloud-billing-ops["cloud-billing-ops"]
t_engineering-opex-admin["engineering-opex-admin"]
t_observability-labs-maintainers["observability labs maintainers"]
t_observability-labs-reviewers["observability labs reviewers"]
t_search-inference-team["search-inference-team"]
t_otel-devs["otel-devs"]
t_search-kibana["Search Kibana"]
t_engineering-ux-admin["engineering-ux-admin"]
t_engineering-docs-admin["engineering-docs-admin"]
t_doc-contractors["doc-contractors"]
t_crm-prod["crm-prod"]
t_control-plane-serverless-security-responders["control-plane-serverless-security-responders"]
t_es-search-foundations["es-search-foundations"]
t_cloud-ui-core["cloud-ui-core"]
t_es-search-relevance["es-search-relevance"]
t_ricardo-team["Ricardo - Team"]
t_csg-services-amer-commercial["csg-services-amer-commercial"]
t_search-extract-and-transform["search-extract-and-transform"]
t_opex-contractors["opex-contractors"]
t_idea-readonly["idea-readonly"]
t_fintran["FinTran"]
t_obs-entities["obs-entities"]
t_observablt-admins["observablt-admins"]
t_es-multiproject["es-multiproject"]
t_opex-product["opex-product"]
t_cloud-billing["cloud-billing"]
t_appex-ai-infra["AppEx AI Infra"]
t_trade-admins["TRaDE Admins"]
t_search-product-team["Search Product Team"]
t_nuugen-test-team["nuugen-test-team"]
t_nuugen-test-team-1["nuugen-test-team-1"]
t_es-distributed-indexing["es-distributed-indexing"]
t_es-distributed-coordination["es-distributed-coordination"]
t_elastic-endpoint-automation["elastic-endpoint-automation"]
t_tmp-employees-o11ylabs["tmp-employees-o11ylabs"]
t_internal-audit["internal-audit"]
t_obs-ds-managed-services["obs-ds-managed-services"]
t_marketing-innovation["marketing-innovation"]
t_ecp-read-only["ecp-read-only"]
t_genai-instrumentation["GenAI Instrumentation"]
t_data-eng["data-eng"]
t_rev-reporting["rev-reporting"]
t_support-analytics["support-analytics"]
t_github-contractors["GitHub - Contractors"]
t_github-service-accounts["GitHub - Service Accounts"]
t_ricardo-test-team["Ricardo Test Team"]
t_serverless-gitops-readers["serverless-gitops-readers"]
t_curriculum-design["curriculum-design"]
t_argo-workflows-trigger-buildkite["argo-workflows-trigger-buildkite"]
t_acrolinx-bot["Acrolinx-bot"]
t_platform-engprod-devenv["platform-engprod-devenv"]
t_docs-automation["docs-automation"]
t_renovate-read-secrets["renovate-read-secrets"]
t_infra-ci-gobld-pipelines["infra-ci-gobld-pipelines"]
t_streams-program-team["streams-program-team"]
t_fleet-service["fleet-service"]
t_platform-billing-experience["platform-billing-experience"]
t_iar-contributors["iar-contributors"]
t_iar-operators["iar-operators"]
t_on-week-oss-dashboard["on-week-oss-dashboard"]
t_control-plane-stateful-security-responders["control-plane-stateful-security-responders"]
t_github-team-sync-test["Github Team Sync - Test"]
t_it-eng-test["it-eng-test"]
t_docs-freeze-team["docs-freeze-team"]
t_cypress["cypress"]
t_infosec-repo-read-only["InfoSec Repo Read Only"]
t_obs-ui-devex-team["obs-ui-devex-team"]
t_pk-dev-build-owners["pk-dev-build-owners"]
t_ax-design["ax-design"]
t_engineering["Engineering"]
t_sdh-assignment-owners["sdh-assignment-owners"]
t_cloud-infra-oncall["Cloud Infra Oncall"]
t_oblt-gh-secrets-manager-golang-crossbuild["oblt-gh-secrets-manager-golang-crossbuild"]
t_ecp-team["ecp-team"]
t_search-data-science["search-data-science"]
t_platform-eng-prod-us["platform-eng-prod-us"]
t_sit-crest-contractors["sit-crest-contractors"]
t_agentless-team["agentless-team"]
t_itops-okta["itops-okta"]
t_observablt-ci-contractors["observablt-ci-contractors"]
t_ce-edu-content["ce-edu-content"]
t_ce-edu-infra["ce-edu-infra"]
t_ce-edu-automation["ce-edu-automation"]
t_integration-experience["Integration-Experience"]
t_elasticgpt-team["ElasticGPT-Team"]
t_elastic-it-qa-admins["elastic-it-qa-admins"]
t_ce-edu-viewers["ce-edu-viewers"]
t_ce-edu-isd["ce-edu-isd"]
t_finops-sre["finops-sre"]
t_search-analytics["search-analytics"]
t_admin-xp-leads["admin-xp-leads"]
t_ce-edu-build-owners["ce-edu-build-owners"]
t_edu-security-legacy["edu-security-legacy"]
t_edu-core-legacy["edu-core-legacy"]
t_ce-edu-infra-admins["ce-edu-infra-admins"]
t_ce-edu-codeowners["ce-edu-codeowners"]
t_ce-edu-docs-owners["ce-edu-docs-owners"]
t_integrations-triaging["integrations-triaging"]
t_genai-instrumentation-leads["GenAI Instrumentation Leads"]
t_workchat["workchat"]
t_workchat-eng["workchat-eng"]
t_test-infosec-sync["test-infosec-sync"]
t_ce-edu-janitors["ce-edu-janitors"]
t_it-infra["it-infra"]
t_epaminferencecontractors["EPAMInferenceContractors"]
t_ski-docs["ski-docs"]
t_core-docs["core-docs"]
t_admin-docs["admin-docs"]
t_developer-docs["developer-docs"]
t_eah-ctf-organizers["eah-ctf-organizers"]
t_ce-edu-contributors["ce-edu-contributors"]
t_workflows-eng["workflows-eng"]
t_kibana-cases["kibana-cases"]
t_csg-services-splunk-migration-dev["csg-services-splunk-migration-dev"]
t_entity-store["entity-store"]
t_ingest-team["ingest-team"]
t_logstash-docs["logstash-docs"]
t_elasticgpt-dev["ElasticGPT-Dev"]
t_elasticgpt-developers["ElasticGPT-Developers"]
t_amer-consulting-security-team["amer-consulting-security-team"]
t_docs-tech-leads["docs-tech-leads"]
t_csg-services-amer-search["csg-services-amer-search"]
t_education-ilt["Education-ILT"]
t_ecp-traffic-team["ECP Traffic team"]
t_infra-performance["infra-performance"]
t_esql-search["esql-search"]
t_sec-crt-team["sec-crt-team"]
t_trade-collaboration["TRADE Collaboration"]
t_csg-services-engineering["csg-services-engineering"]
t_sales-strat-op["sales-strat-op"]
t_csg-strat-ops["csg-strat-ops"]
t_contextual-security["contextual-security"]
t_es-machine-learning-core["es-machine-learning-core"]
t_docs-serverless-release-team["docs-serverless-release-team"]
t_core-analysis["core-analysis"]
t_contextual-security-apps["contextual-security-apps"]
t_cloud-services["cloud-services"]
t_platform-shared-services["platform-shared-services"]
t_project-docs["project-docs"]
t_autoops-incident-responders["autoops-incident-responders"]
t_it-data-integrations-code-owners["it-data-integrations-code-owners"]
t_ecp-service-placement["ecp-service-placement"]
t_observability --> t_apm
t_platform-design --> t_kibana-design
t_infra-monitoring-ui --> t_stack-monitoring
t_cloud-sre --> t_cloud-security
t_support-ops-automation --> t_revtech-eng
t_obs-ux-infra_services-team --> t_apm-ui
t_cloud-team --> t_ece-experts
t_obs-ds-edge-collection --> t_apm-agent-devs
t_apm --> t_apm-server
t_elasticsearch-team --> t_es-search
t_elasticsearch-team --> t_es-core-infra
t_elasticsearch-team --> t_es-distributed-obsolete
t_elasticsearch-team --> t_es-security
t_elasticsearch-team --> t_es-ql
t_search-eng --> t_swiftype-sre
t_cloud-team --> t_cloud-pms
t_cloud-team --> t_cloud-ui
t_cloud-sre --> t_cloud-sre-emea
t_cloud-sre --> t_cloud-sre-nasa
t_cloud-sre --> t_cloud-sre-apj
t_machine-learning --> t_ml-core
t_machine-learning --> t_ml-ui
t_elasticsearch-team --> t_es-docs
t_cloud-team --> t_cloud-qa
t_cloud-sre --> t_cloud-sre-leads
t_machine-learning --> t_ml-pm
t_cloud-sre --> t_cloud-tooling
t_security-solution --> t_siem
t_observability --> t_infra-monitoring-ui
t_elasticsearch-team --> t_es-data-management
t_elasticsearch-team --> t_es-analytics-geo
t_observability --> t_integrations
t_observability --> t_uptime
t_ski-docs --> t_experience-docs
t_cloud-sre --> t_cloud-infra
t_support --> t_support-tech-leads
t_control-plane-applications --> t_cloud-orchestration
t_observability --> t_observablt-robots
t_cloud-team --> t_control-plane-ingress
t_observability --> t_observability-design
t_cloud-team --> t_platform-billing
t_observability --> t_observability-leads
t_datavis --> t_elastic-charts
t_deprecated-continuous-integration --> t_ci-systems
t_platform-eng-prod --> t_release-eng
t_endpoint-app-team --> t_endpoint-response
t_security-solution --> t_security-onboarding-and-lifecycle-mgt
t_endpoint-app-team --> t_endpoint-data-visibility-team
t_mlr-docs --> t_ml-docs
t_protections --> t_security-ml
t_protections --> t_security-data-engineering
t_protections --> t_security-intelligence-analytics
t_endpoint --> t_elastic-endpoint
t_search-eng --> t_devtools-team
t_protections --> t_protections-leads
t_protections --> t_endpoint-protections
t_elastic-endgame --> t_endgame-sre
t_protections --> t_eql-rules-developers
t_ux --> t_security-design
t_elasticsearch-team --> t_es-perf
t_endpoint --> t_endpoint-app-team
t_elasticsearch-team --> t_vulnerabilities-elasticsearch
t_education --> t_curriculum-dev
t_apm-agent-devs --> t_apm-agent-java
t_apm-agent-devs --> t_apm-agent-ruby
t_apm-agent-devs --> t_apm-agent-go
t_apm-agent-devs --> t_apm-agent-python
t_apm-agent-devs --> t_apm-agent-node-js
t_apm-agent-devs --> t_apm-agent-php
t_apm-agent-devs --> t_apm-agent-net
t_apm-agent-devs --> t_apm-agent-rum
t_cloud-sre --> t_cloud-reliability
t_ux --> t_search-design
t_observability --> t_obs-docs
t_observability --> t_observability-ui
t_services --> t_services-delivery
t_education --> t_education-contributors
t_demandegen --> t_cloudtrials-dg
t_security-solution --> t_security-external-integrations
t_infosec --> t_risk-management
t_infosec --> t_governance
t_infosec --> t_detection
t_infosec --> t_threat-intel
t_infosec --> t_incident-response
t_infosec --> t_infosec-security-assurance
t_infosec --> t_product-security
t_apm --> t_apm-pm
t_ux --> t_platform-design
t_cloud-team --> t_cloud-guests
t_machine-learning --> t_ml-rd
t_elasticsearch-team --> t_es-delivery
t_security-solution --> t_security-detections-response
t_observability --> t_ingest-fp
t_ingest-fp --> t_elastic-agent
t_ingest-fp --> t_fleet
t_apm-agent-devs --> t_apm-agent-ios
t_enterprise-search --> t_search-leads
t_security-solution --> t_security-threat-hunting
t_security-solution --> t_security-threat-intelligence
t_security-solution --> t_security-engineering-productivity
t_elasticsearch-team --> t_es-leads
t_security-solution --> t_security-asset-management
t_services --> t_csg-services-arb
t_observability --> t_observability-rac
t_ingest-fp --> t_ecosystem
t_control-plane-applications --> t_cloud-applications-es
t_control-plane-applications --> t_cloud-applications-solutions
t_enterprise-search --> t_search-eng
t_elastic-agent --> t_elastic-agent-data-plane
t_elastic-agent --> t_elastic-agent-control-plane
t_security-detections-response --> t_security-detection-rule-management
t_observablt-robots --> t_observablt-robots-contractors
t_security-detections-response --> t_security-solution-platform
t_security-solution --> t_security-data-analytics
t_webteam --> t_web-launches
t_observability --> t_unified-observability
t_observability --> t_actionable-observability
t_security-solution --> t_cloud-security-posture
t_observability --> t_profiling
t_cloud-sre --> t_platform-capacity
t_security-detections-response --> t_security-detections-response-alerts
t_observability --> t_profiling-contractors
t_search-eng --> t_search-experiences-team
t_response-ops --> t_response-ops-execution
t_response-ops --> t_response-ops-ram
t_platform --> t_sre
t_sre --> t_infra-sre
t_infra-sre --> t_infra-foundations
t_infra-sre --> t_infra-services
t_infra-sre --> t_infra-systems
t_platform-design --> t_global-ux
t_platform-writers --> t_cloud-writers
t_security-threat-hunting --> t_security-threat-hunting-explore
t_security-threat-hunting --> t_security-threat-hunting-investigations
t_platform-docs --> t_mlr-docs
t_cloud-security-posture --> t_cloudbeat
t_cloud-security-posture --> t_kibana-cloud-security-posture
t_infra-systems --> t_infra-systems-network
t_protections --> t_threat-research-and-detection-engineering
t_infra-systems --> t_infra-systems-puppet
t_ingest-fp --> t_elastic-agent-release
t_edu-security-legacy --> t_purple-kittens-dev
t_edu-security-legacy --> t_purple-kittens-instructors
t_security-intelligence-analytics --> t_threat-intelligence-research
t_apm --> t_apm-leads
t_security-intelligence-analytics --> t_malware-analysis-and-reverse-engineering
t_apm-agent-devs --> t_apm-agent-android
t_cloud-security-posture --> t_csp-security-policies
t_education --> t_certification-admins
t_protections --> t_protections-experience
t_cloud-journey --> t_platform-onboarding
t_cloud-security-posture --> t_csp-automation
t_cloud-security-posture --> t_csp-ops
t_response-ops --> t_response-ops-pm
t_cloud-journey --> t_platform-marketplaces
t_observablt-robots --> t_observablt-ci
t_observablt-robots --> t_observablt-dx
t_observablt-robots --> t_observablt-pf
t_security-data-engineering --> t_threat-data-services
t_infosec --> t_infosec-enablement
t_sre --> t_platform-security
t_infosec --> t_infosec-delivery
t_protections --> t_mare-team
t_infra-sre --> t_infra-mki
t_services --> t_consulting-emea
t_security-solution --> t_security-defend-workflows
t_services --> t_csg-services-admins
t_protections --> t_elastic-security-labs
t_control-plane-stateful --> t_control-plane-stateful-foundations
t_control-plane-stateful --> t_control-plane-hosted-applications
t_security-ml --> t_sec-applied-ml
t_security-ml --> t_sec-ml-ops
t_ski-docs --> t_ingest-docs
t_control-plane-serverless --> t_serverless-core
t_platform-billing --> t_platform-billing-engineers
t_ingest-fp --> t_ingest-tech-lead
t_control-plane-serverless --> t_serverless-ui
t_observability --> t_app-obs
t_ecp-team --> t_ecp-services
t_observability --> t_observability-asset-management
t_edu-security-legacy --> t_purple-kittens-automation
t_security-detections-response --> t_security-detection-engine
t_security-solution --> t_security-tech-leads
t_ingest-fp --> t_fleet-security-triage
t_control-plane-serverless --> t_serverless-applications
t_ingest-fp --> t_ingest-eng-prod
t_elastic-endgame --> t_endgame-sec
t_docs --> t_doc-leads
t_observability --> t_obs-bi-team
t_search-eng --> t_search-relevance
t_search-eng --> t_search-productivity-team
t_observability --> t_obs-ai-assistant
t_docs --> t_platform-docs
t_platform-analytics --> t_platform-analytics-indexing
t_salesgpt-all-members --> t_salesgpt-admins
t_salesgpt-all-members --> t_salesgpt-core-team
t_security-solution --> t_security-entity-analytics
t_obs-ux-team --> t_obs-ux-logs-team
t_obs-ux-team --> t_obs-ux-management-team
t_obs-experience-team --> t_obs-knowledge-team
t_obs-ux-team --> t_obs-ux-infra_services-team
t_cloud-tooling --> t_tooling-qasource
t_platform-eng-prod --> t_eng-prod-engagement-team
t_docs --> t_integration-docs
t_docs --> t_docs-stack-release-team
t_docs --> t_search-docs
t_obs-ds-managed-services --> t_obs-ds-hosted-services
t_obs-ds-hosted-services --> t_obs-ds-hosted-services-synthrum
t_opentelemetry-program-team --> t_opentelemetry-leads
t_docs --> t_docs-repo-owners
t_security-solution --> t_security-solution-test-skippers
t_services --> t_apj-consulting
t_control-plane-hosted-applications --> t_terraform-providers-admins
t_elasticsearch-team --> t_es-analytical-engine
t_elasticsearch-team --> t_es-storage-engine
t_opex --> t_opex-devops
t_opex --> t_opex-front
t_opex --> t_opex-back
t_security-entity-analytics --> t_security-entity-analytics-qa
t_obs-ds-managed-services --> t_obs-ds-intake-services
t_security-external-integrations --> t_security-service-integrations
t_security-integrations-operations --> t_security-integrations-operations-infrastructure
t_security-integrations-operations --> t_security-integrations-operations-data-analytics
t_security-solution --> t_security-scalability
t_observability --> t_obs-ds-edge-collection
t_obs-ds-edge-collection --> t_ingest-otel-data
t_security-solution --> t_security-generative-ai
t_edu-security-legacy --> t_purple-kittens-command
t_platform-billing-engineers --> t_platform-billing-ws-marketplaces
t_platform-eng-prod --> t_platform-dev-flow
t_platform-productivity-engineering --> t_software-supply-chain-security-team
t_observability --> t_eco
t_platform-eng-prod --> t_productivity-foundations
t_search-eng --> t_app-search-team
t_platform-billing-engineers --> t_platform-billing-bm
t_response-ops --> t_response-ops-management-experiences
t_observability --> t_obs-experience-team
t_obs-experience-team --> t_obs-ux-team
t_search-eng --> t_search-inference-team
t_search-eng --> t_search-kibana
t_docs --> t_doc-contractors
t_elasticsearch-team --> t_es-search-foundations
t_cloud-team --> t_cloud-ui-core
t_elasticsearch-team --> t_es-search-relevance
t_services --> t_csg-services-amer-commercial
t_search-eng --> t_search-extract-and-transform
t_opex-devops --> t_opex-contractors
t_observability --> t_obs-entities
t_observablt-robots --> t_observablt-admins
t_elasticsearch-team --> t_es-multiproject
t_cloud-team --> t_cloud-billing
t_threat-research-and-detection-engineering --> t_trade-admins
t_enterprise-search --> t_search-product-team
t_elasticsearch-team --> t_es-distributed-indexing
t_elasticsearch-team --> t_es-distributed-coordination
t_observability --> t_obs-ds-managed-services
t_observability --> t_genai-instrumentation
t_education --> t_curriculum-design
t_docs-engineering --> t_acrolinx-bot
t_ingest-fp --> t_fleet-service
t_platform-billing-engineers --> t_platform-billing-experience
t_docs --> t_docs-freeze-team
t_observability --> t_obs-ui-devex-team
t_purple-kittens-dev --> t_pk-dev-build-owners
t_platform-design --> t_ax-design
t_ce-edu-team --> t_ce-edu-content
t_ce-edu-team --> t_ce-edu-infra
t_ce-edu-codeowners --> t_ce-edu-automation
t_ce-edu-team --> t_ce-edu-viewers
t_ce-edu-team --> t_ce-edu-isd
t_cloud-sre --> t_finops-sre
t_ce-edu-codeowners --> t_ce-edu-build-owners
t_ce-edu-team --> t_edu-security-legacy
t_ce-edu-team --> t_edu-core-legacy
t_ce-edu-infra --> t_ce-edu-infra-admins
t_ce-edu-team --> t_ce-edu-codeowners
t_ce-edu-codeowners --> t_ce-edu-docs-owners
t_search-eng --> t_workchat
t_search-eng --> t_workchat-eng
t_ce-edu-team --> t_ce-edu-janitors
t_docs --> t_ski-docs
t_docs --> t_core-docs
t_core-docs --> t_admin-docs
t_core-docs --> t_developer-docs
t_ce-edu-team --> t_ce-edu-contributors
t_cloud-security-posture --> t_workflows-eng
t_services --> t_csg-services-splunk-migration-dev
t_cloudbeat --> t_entity-store
t_observability --> t_ingest-team
t_ingest-docs --> t_logstash-docs
t_docs --> t_docs-tech-leads
t_csg-services-amer-commercial --> t_csg-services-amer-search
t_education --> t_education-ilt
t_ecp-team --> t_ecp-traffic-team
t_platform-eng-prod --> t_infra-performance
t_services --> t_csg-services-engineering
t_sales-insights --> t_sales-strat-op
t_security-solution --> t_contextual-security
t_elasticsearch-team --> t_es-machine-learning-core
t_docs --> t_docs-serverless-release-team
t_contextual-security --> t_core-analysis
t_contextual-security --> t_contextual-security-apps
t_contextual-security --> t_cloud-services
t_cloud-team --> t_platform-shared-services
t_it-data-integrations-admins --> t_it-data-integrations-code-owners
```

## Generated

This file was automatically generated on 2025-09-21T07:34:41.024Z.
