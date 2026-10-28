# Blue/green neutral review migration

Status: accepted local implementation decision; factual source/external results remain separately measured gates.

Use new PrismOracleAssessmentReview/PrismCrmAssessmentReview stacks in us-east-2 with review terminology and exact project_name tags. Use standard CDK bootstrap with task qualifier prismrvw and default asset publication/deployment. Preserve historical us-east-1 stacks as rollback. No destructive old-stack migration is included.
