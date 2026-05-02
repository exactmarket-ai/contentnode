CREATE TABLE team_member_clients (
  team_member_id  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id       text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  agency_id       text NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_member_id, client_id)
);

CREATE INDEX team_member_clients_agency_id_idx ON team_member_clients(agency_id);
CREATE INDEX team_member_clients_client_id_idx ON team_member_clients(client_id);
