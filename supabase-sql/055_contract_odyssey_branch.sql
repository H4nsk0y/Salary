-- Adds the contract production branch used by profiles and the split admin table.
begin;

alter table public.profiles
  drop constraint if exists profiles_branch_check;

alter table public.profiles
  add constraint profiles_branch_check
  check (
    branch is null
    or branch in (
      'chateau_alvisa',
      'alvisa_whisky',
      'alvisa_beverage',
      'alvisa_whisky_distillery',
      'kin_wine_cognac_factory',
      'contract_odyssey'
    )
  );

-- Existing security and owner functions validate the same allow-list. Patch their
-- stored definitions so this migration remains compatible with the installed versions.
do $$
declare
  signature text;
  definition text;
begin
  foreach signature in array array[
    'public.validate_profile_write()',
    'public.owner_update_user_profile(uuid,text,text,text,text,text,date,numeric)',
    'public.owner_update_user_profile_v2(uuid,text,text,text,text,text,date,numeric,numeric)'
  ] loop
    if to_regprocedure(signature) is null then
      continue;
    end if;

    definition := pg_get_functiondef(to_regprocedure(signature));
    if position('contract_odyssey' in definition) = 0 then
      definition := replace(
        definition,
        '''kin_wine_cognac_factory''',
        '''kin_wine_cognac_factory'', ''contract_odyssey'''
      );
      execute definition;
    end if;
  end loop;
end $$;

commit;
