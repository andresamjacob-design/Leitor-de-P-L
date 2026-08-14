/**
 * Clients and people. Both are counterparties the ledger points at, and both are matched
 * against the statement by CNPJ/CPF — which is why the tax id is stored digits-only.
 */

import { createClient } from "@/lib/supabase/server";
import { normalizeTaxId } from "@/lib/tax-id";

export type Client = {
  id: string;
  entityId: string;
  name: string;
  taxId: string | null;
  notes: string | null;
  active: boolean;
};

const CLIENT_COLUMNS = "id, entity_id, name, tax_id, notes, active";

type ClientRow = {
  id: string;
  entity_id: string;
  name: string;
  tax_id: string | null;
  notes: string | null;
  active: boolean;
};

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    entityId: row.entity_id,
    name: row.name,
    taxId: row.tax_id,
    notes: row.notes,
    active: row.active,
  };
}

export async function listClients(
  entityIds: string[],
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Client[]> {
  if (entityIds.length === 0) return [];
  const supabase = await createClient();
  let query = supabase.from("clients").select(CLIENT_COLUMNS).in("entity_id", entityIds);
  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query.order("name");
  if (error) throw new Error(`não foi possível carregar os clientes: ${error.message}`);
  return (data as ClientRow[]).map(toClient);
}

export async function getClient(id: string): Promise<Client | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`não foi possível carregar o cliente: ${error.message}`);
  return data ? toClient(data as ClientRow) : null;
}

export type ClientInput = {
  name: string;
  taxId: string | null;
  notes: string | null;
  active: boolean;
};

export async function createClientRecord(entityId: string, input: ClientInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({ entity_id: entityId, ...clientRow(input) })
    .select("id")
    .single();

  if (error) throw new Error(`não foi possível criar o cliente: ${error.message}`);
  return (data as { id: string }).id;
}

export async function updateClientRecord(id: string, input: ClientInput): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update(clientRow(input)).eq("id", id);
  if (error) throw new Error(`não foi possível salvar o cliente: ${error.message}`);
}

function clientRow(input: ClientInput) {
  return {
    name: input.name,
    tax_id: input.taxId ? normalizeTaxId(input.taxId) : null,
    notes: input.notes,
    active: input.active,
  };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type PersonKind = "employee" | "contractor" | "partner";
export type PersonBond = "clt" | "pj" | "freelancer" | "estagio" | "socio";

export type PersonRecord = {
  id: string;
  entityId: string;
  name: string;
  role: string | null;
  kind: PersonKind;
  bond: PersonBond | null;
  squad: string | null;
  managerName: string | null;
  clientId: string | null;
  taxId: string | null;
  active: boolean;
};

const PERSON_COLUMNS =
  "id, entity_id, name, role, kind, bond, squad, manager_name, client_id, tax_id, active";

type PersonRow = {
  id: string;
  entity_id: string;
  name: string;
  role: string | null;
  kind: PersonKind;
  bond: PersonBond | null;
  squad: string | null;
  manager_name: string | null;
  client_id: string | null;
  tax_id: string | null;
  active: boolean;
};

function toPerson(row: PersonRow): PersonRecord {
  return {
    id: row.id,
    entityId: row.entity_id,
    name: row.name,
    role: row.role,
    kind: row.kind,
    bond: row.bond,
    squad: row.squad,
    managerName: row.manager_name,
    clientId: row.client_id,
    taxId: row.tax_id,
    active: row.active,
  };
}

export async function listPeopleRecords(
  entityIds: string[],
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<PersonRecord[]> {
  if (entityIds.length === 0) return [];
  const supabase = await createClient();
  let query = supabase.from("people").select(PERSON_COLUMNS).in("entity_id", entityIds);
  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query.order("name");
  if (error) throw new Error(`não foi possível carregar as pessoas: ${error.message}`);
  return (data as PersonRow[]).map(toPerson);
}

export async function getPerson(id: string): Promise<PersonRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .select(PERSON_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`não foi possível carregar a pessoa: ${error.message}`);
  return data ? toPerson(data as PersonRow) : null;
}

export type PersonInput = {
  name: string;
  role: string | null;
  kind: PersonKind;
  bond: PersonBond | null;
  squad: string | null;
  managerName: string | null;
  clientId: string | null;
  taxId: string | null;
  active: boolean;
};

export async function createPerson(entityId: string, input: PersonInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .insert({ entity_id: entityId, ...personRow(input) })
    .select("id")
    .single();

  if (error) throw new Error(`não foi possível criar a pessoa: ${error.message}`);
  return (data as { id: string }).id;
}

export async function updatePerson(id: string, input: PersonInput): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("people").update(personRow(input)).eq("id", id);
  if (error) throw new Error(`não foi possível salvar a pessoa: ${error.message}`);
}

function personRow(input: PersonInput) {
  return {
    name: input.name,
    role: input.role,
    kind: input.kind,
    bond: input.bond,
    squad: input.squad,
    manager_name: input.managerName,
    client_id: input.clientId,
    tax_id: input.taxId ? normalizeTaxId(input.taxId) : null,
    active: input.active,
  };
}
