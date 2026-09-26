from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv
from geoalchemy2 import alembic_helpers

from infraalert.db.models import Base
from infraalert.db.session import database_url, make_engine

load_dotenv()

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    # Tests pass the URL through the Alembic config; everything else uses DATABASE_URL.
    return config.get_main_option("sqlalchemy.url") or database_url()


def _include_object(obj, name, type_, reflected, compare_to):  # type: ignore[no-untyped-def]
    # Ignore PostGIS's own tables (spatial_ref_sys, …) during autogenerate.
    if type_ == "table" and reflected and compare_to is None:
        return False
    return alembic_helpers.include_object(obj, name, type_, reflected, compare_to)


_CONFIGURE_KWARGS = dict(
    target_metadata=target_metadata,
    include_object=_include_object,
    process_revision_directives=alembic_helpers.writer,
    render_item=alembic_helpers.render_item,
    compare_type=True,
)


def run_migrations_offline() -> None:
    context.configure(url=_url(), literal_binds=True, **_CONFIGURE_KWARGS)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = make_engine(_url())
    with engine.connect() as connection:
        context.configure(connection=connection, **_CONFIGURE_KWARGS)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
