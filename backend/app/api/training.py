from fastapi import APIRouter, Depends

from ..services import Services, get_services

router = APIRouter(tags=["training"])


@router.get("/training/{job_id}")
def get_job(job_id: str, services: Services = Depends(get_services)):
    return services.training.get(job_id).to_dict()
