# {{NOMBRE_DEL_PROYECTO}}

## Descripción
{{DESCRIPCIÓN_BREVE_DEL_NEGOCIO}}

## Arquitectura
{{DESCRIBIR_SI_ES_1_REPO_O_VARIOS_REPOS_RELACIONADOS}}

| Capa | Path | Stack |
|---|---|---|
| DB | {{PATH_DB}} | {{MOTOR_DB}} |
| Backend | {{PATH_BACKEND}} | {{FRAMEWORK_BACKEND}} |
| Frontend | {{PATH_FRONTEND}} | {{FRAMEWORK_FRONTEND}} |

## Convenciones
{{ESTILO_DE_CODIGO_COMMITS_BRANCHES_ETC}}

## Notas de despliegue
{{COMO_SE_DEPLOYEA_CADA_CAPA}}

---
_Este archivo es local a este proyecto y contiene solo contexto de negocio.
La arquitectura de agentes (ADF) es genérica y vive en `tools/dev-toolkit/` —
no dupliques esa info acá. `CLAUDE.md` y `GEMINI.md` son symlinks a este
mismo archivo, para no mantener el negocio duplicado entre los dos CLIs._
