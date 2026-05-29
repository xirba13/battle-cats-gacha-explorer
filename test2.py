import re
import collections
import html
import os

def check_domination(new_tickets, new_catfood, visited_states):
    for (e_tick, e_cf) in visited_states:
        if e_tick <= new_tickets and e_cf <= new_catfood:
            return True
    return False

def update_visited(new_tickets, new_catfood, visited_states):
    new_list = [
        (t, c) for (t, c) in visited_states
        if not (new_tickets <= t and new_catfood <= c)
    ]
    new_list.append((new_tickets, new_catfood))
    return new_list

############################################################################################
########################################## Configuration ###################################
############################################################################################

DATA_FILE = 'data.txt'
MAX_SEARCH_STEPS = 100000000
MAX_SOLUTIONS = 100000

BANNER_LIMITS = {
    # Banner Index (0-based): Max Actions (Rolls or 11-Draws)
    # Example: Limit Banner 5 (index 4) to 1 action (Legend Ticket Banner in the example data)
    4: 1
}

TARGET_UBERS = {
    "Balrog Cat",
    "Vega Cat",
    "Sagat Cat",
    "M. Bison Cat",
    "C. Honda",
    "Zangief Cat",
    "Jamie Cat",
    "Blanka",
    "Dhalsim",
    "Ken",
    "E. Honda",
    "Sagat",
    "M. Bison",
    "Luke",
    "Juri",
    "Akuma",
    "Ryu",
    "Chun-Li",
    "Zangief",
    "Vega",
    "Guile",
    "Balrog",
    "Sakura",
    "Cammy"
}

# Search Mode Configuration
MODE = "RESOURCE_LIMIT"  
# Modes:
# "STRICT": Require ALL targets within infinite resources.
# "BEST_EFFORT": Maximize targets found within infinite resources.
# "RESOURCE_LIMIT": Maximize targets found within specific resource limits (BEST_EFFORT style).

MAX_CATFOOD = 4500   # Used only in RESOURCE_LIMIT mode
MAX_TICKETS = 300    # Used only in RESOURCE_LIMIT mode

# Starting seed in the example data: 139026851

############################################################################################
######################################## End of Configuration ##############################
############################################################################################

def parse_data(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()

    # Split into tables (Banners)
    # The file starts with <table>, so splitting by <table gives empty first element
    tables = content.split('<table')
    banners = []
    
    # Skip the first empty split if it exists, or just iterate
    for table_content in tables:
        if not table_content.strip():
            continue
        
        banner_data = {} # Key: "1A", "1B", etc. Value: { 'unit': ..., 'guaranteed': ..., 'next_g': ..., 'alt': ... }
        
        # Find all pick calls
        # Pattern: pick('(\d+)([AB])(R?)(G?)')
        # We need to capture the cell content to extract Unit Name and Next Pos
        
        # We iterate over all matches of pick(...) and look at the surrounding td content
        # Since regex on large file with complex lookaround is hard, let's find all <td>...</td> blocks that contain pick
        
        # Regex to find td with pick
        # <td ... onclick="pick('1A')"> ... </td>
        
        cell_pattern = re.compile(r'<td[^>]*onclick="pick\(\'([0-9]+)([AB])(R?)(G?)X?\'\)"[^>]*>(.*?)</td>', re.DOTALL)
        
        matches = cell_pattern.findall(table_content)
        
        for num, track, is_alt, is_guaranteed, cell_html in matches:
            pos_key = f"{num}{track}"
            
            # Unescape HTML
            cell_text = html.unescape(cell_html)
            
            # Parse Unit Name
            # Look for <a ...>Name</a>
            name_match = re.search(r'>([^<]+)</a>', cell_text)
            unit_name = name_match.group(1).strip() if name_match else None
            
            if not unit_name:
                continue

            # Parse Next Position (for Guaranteed or Alt)
            # Look for <- 12A or -> 12B
            next_pos_match = re.search(r'(?:<-|->)\s*(\d+[AB])', cell_text)
            next_pos = next_pos_match.group(1) if next_pos_match else None
            
            if pos_key not in banner_data:
                banner_data[pos_key] = {}
            
            entry = banner_data[pos_key]
            
            if is_guaranteed == 'G':
                if is_alt == 'R':
                    # Guaranteed Alt (Duplicate Rare -> Guaranteed?)
                    # Usually this means if you are on the duplicate path, and roll guaranteed.
                    entry['alt_guaranteed_unit'] = unit_name
                    entry['alt_guaranteed_next'] = next_pos
                else:
                    entry['guaranteed_unit'] = unit_name
                    entry['guaranteed_next'] = next_pos
            else:
                if is_alt == 'R':
                    entry['alt_unit'] = unit_name
                    entry['alt_next'] = next_pos
                else:
                    entry['unit'] = unit_name
                    # Normal roll next is usually num+1, same track
                    # But we calculate that dynamically
        
        banners.append(banner_data)
        

        max_n = 0
        for k in banner_data.keys():
            n = int(k[:-1])
            if n > max_n: max_n = n
        print(f"Banner parsed. Max roll: {max_n}. Keys: {len(banner_data)}")
        
    return banners

def get_next_pos_normal(current_pos, current_unit, banner_data, last_unit_name):
    # current_pos: "1A"
    # Logic:
    # 1. Check if we have a duplicate rare situation.
    #    If last_unit_name == current_unit (and maybe check rarity? but name check is usually enough for duplicates),
    #    and banner_data has 'alt_unit' for this pos.
    #    Then we use alt_unit and alt_next.
    # 2. Else, use normal unit. Next pos is (num+1) + track.
    
    num = int(current_pos[:-1])
    track = current_pos[-1]
    
    entry = banner_data.get(current_pos)
    if not entry:
        return None, None, None # End of data
        
    # Check duplicate
    # Note: The "current_unit" passed here is the one we *would* get normally.
    # But wait, if it's a duplicate, we get the Alt unit instead.
    # So we need to check the *Normal* unit at this position against the *Last* unit we got.
    
    normal_unit = entry.get('unit')
    
    if last_unit_name and normal_unit == last_unit_name and 'alt_unit' in entry:
        # Duplicate detected!
        actual_unit = entry['alt_unit']
        next_p = entry.get('alt_next')
        # If alt_next is not explicit, what happens?
        # Usually duplicate rare switches track.
        # If the data doesn't say, we might be stuck. But the data seems to have <- 9A etc.
        if not next_p:
             # Fallback? Usually switches track. 1A -> 2B?
             # But let's assume data is complete for duplicates.
             pass
        return actual_unit, next_p, "Duplicate"
    else:
        actual_unit = normal_unit
        next_p = f"{num+1}{track}"
        return actual_unit, next_p, "Normal"

import heapq

def solve():
    banners = parse_data(DATA_FILE)
    print(f"Parsed {len(banners)} banners.")
    for i, b in enumerate(banners):
        print(f"Banner {i+1} has {len(b)} entries.")
        if "1A" in b:
            print(f"Sample 1A: {b['1A']}")
            
    if len(banners) < 2:
        print("Error: Need 2 banners.")
        return

    # Map Targets to IDs for Bitmask
    sorted_targets = sorted(list(TARGET_UBERS))
    target_to_id = {name: i for i, name in enumerate(sorted_targets)}
    all_targets_mask = (1 << len(sorted_targets)) - 1
    
    print(f"Target Units ({len(sorted_targets)}):")
    for i, t in enumerate(sorted_targets):
        print(f"  [{i}] {t}")

    # Priority Queue State: (priority_tuple, steps_count, pos_str, collected_mask, last_unit_name, usage_tuple, path_node)
    # path_node: (action_tuple, parent_node) or None
    # action_tuple: (msg, acquired_list, pos)
    
    start_pos = "1A"
    initial_collected = 0
    initial_usage = (0,) * len(banners)
    initial_path = None
    initial_resources = (0, 0) # (tickets, catfood)
    initial_dupes = 0
    
    pq = []
    # Priority: (negative collected count, catfood spent, tickets spent)
    # State: (priority, steps, pos, collected, last_unit, usage, path, resources, dupe_count)
    heapq.heappush(pq, ((0, 0, 0), 0, start_pos, initial_collected, None, initial_usage, initial_path, initial_resources, initial_dupes))
    
    visited = {}
    
    def get_visited_key(p, c, l, u):
        relevant_usage = tuple(u[i] if i in BANNER_LIMITS else -1 for i in range(len(u)))
        return (p, c, l, relevant_usage)
    
    # We track Pareto-optimal resource usage for each state.
    # This prevents pruning paths that reached the same state "slower" (more steps) but with fewer resources used.

    start_key = get_visited_key(start_pos, initial_collected, None, initial_usage)
    visited[start_key] = [(0, 0)]
    
    iterations = 0
    solutions = []
    max_found_count = 0 
    
    max_steps = MAX_SEARCH_STEPS
    
    try:
        while pq:
            state = heapq.heappop(pq)
            # Handle variable unpacking for backward compatibility if I messed up tuples
            if len(state) == 8:
                _, steps, pos, collected, last_unit, usage, path, (res_tickets, res_catfood) = state
            elif len(state) == 9:
                # Assuming priority and steps got merged or something? Or maybe I pushed them flat?
                # Check push: (priority, steps, next_p, new_collected, unit_got, new_usage, new_path, (res...))
                # 0: priority
                # 1: steps
                # 2: pos
                # 3: collected
                # 4: last_unit
                # 5: usage
                # 6: path
                # 7: resources (flattened?)
                
                # If I pushed (..., (new_tickets, new_catfood)), it should be 8.
                # If I pushed (..., new_tickets, new_catfood), it would be 9.
                # Let's check my push calls again.
                # heapq.heappush(pq, (priority, steps + 1, next_p, new_collected, unit_got, new_usage_tuple, new_path_node, (new_tickets, new_catfood)))
                # This has 8 elements.
                
                # Maybe I have a mix of old tuples in the PQ somehow? No, it's a new run.
                
                # Wait! 'priority' is a tuple (-collected_count, steps + 1).
                # So state[0] is that tuple.
                # state[1] is steps + 1.
                # ...
                
                # Why did it crash with "got 9"?
                # Maybe I accidentally flattened the resources tuple in one of the pushes?
                # Let's check the code I just read.
                
                # Push 1: ... new_path_node, (new_tickets, new_catfood))) -> 8 elements.
                # Push 2: ... new_path_node, (new_tickets, new_catfood))) -> 8 elements.
                # Initial push: ... initial_path, initial_resources)) -> 8 elements.
                
                # If "got 9", maybe something else is adding an element?
                # Ah, I see: usage is a tuple.
                # collected is an int.
                # last_unit is a str or None.
                
                # Wait, I might have miscounted the previous unpack failure.
                # "expected 7, got 9".
                # If I am using `_, steps, ... = state` (7 vars).
                # And state has 9 items.
                
                # Let's inspect the pushes again very carefully.
                
                # heapq.heappush(pq, (
                #   priority,           # 1
                #   steps + 1,          # 2
                #   next_p,             # 3
                #   new_collected,      # 4
                #   unit_got,           # 5
                #   new_usage_tuple,    # 6
                #   new_path_node,      # 7
                #   (new_tickets, new_catfood) # 8
                # ))
                
                # It definitely looks like 8.
                
                # UNLESS priority is NOT a tuple?
                # priority = (-collected_count, steps + 1) -> It is a tuple.
                
                # Maybe I should just blindly unpack to *rest?
                pass

            # Let's safe unpack
            if len(state) == 8:
                 _, steps, pos, collected, last_unit, usage, path, res_tuple = state
                 res_tickets, res_catfood = res_tuple
            elif len(state) == 7:
                 _, steps, pos, collected, last_unit, usage, path = state
                 res_tickets, res_catfood = (0, 0)
            else:
                 # Unexpected length, try to salvage
                 _, steps, pos, collected, last_unit, usage, path, *rest = state
                 if rest and isinstance(rest[0], tuple) and len(rest[0]) == 2:
                     res_tickets, res_catfood = rest[0]
                 elif len(rest) == 2:
                     res_tickets, res_catfood = rest[0], rest[1]
                 else:
                     res_tickets, res_catfood = (0, 0)
            
            iterations += 1
            if iterations % 10000 == 0:
                print(f"Iteration {iterations}, Solutions: {len(solutions)} (Best: {max_found_count}), Queue: {len(pq)}")

            if iterations > max_steps:
                print("Max steps reached.")
                break
                
            # Check targets status
            collected_count = bin(collected).count('1')
            
            if MODE == "STRICT":
                if collected == all_targets_mask:
                    # Reconstruct path
                    full_path = []
                    curr = path
                    while curr:
                        action, parent = curr
                        full_path.append(action)
                        curr = parent
                    full_path.reverse()
                    
                    solutions.append((full_path, pos))
                    if len(solutions) >= MAX_SOLUTIONS:
                        print("Reached solution limit.")
                        break
                    continue # Do not extend from a completed path
            
            elif MODE == "BEST_EFFORT" or MODE == "RESOURCE_LIMIT":
                # In BEST_EFFORT/RESOURCE_LIMIT, key is to track the highest count found so far.
                # Since PriorityQueue prioritizes higher counts (via negative collected),
                # the first time we see a count X, it is likely one of the most efficient ways to get there.
                
                # If we found a new best count
                if collected_count > max_found_count:
                    max_found_count = collected_count
                    solutions = [] # Clear previous "best" solutions as we found a better tier
                    print(f"New Best Found: {collected_count} / {len(sorted_targets)} targets!")
                    
                    # Save this new best
                    full_path = []
                    curr = path
                    while curr:
                        action, parent = curr
                        full_path.append(action)
                        curr = parent
                    full_path.reverse()
                    solutions.append((full_path, pos))
                
                elif collected_count == max_found_count and collected_count > 0:
                     # Another solution with the same best count
                     if len(solutions) < MAX_SOLUTIONS:
                        full_path = []
                        curr = path
                        while curr:
                            action, parent = curr
                            full_path.append(action)
                            curr = parent
                        full_path.reverse()
                        solutions.append((full_path, pos))
                
                if collected == all_targets_mask:
                    continue # Stop extending if we got everything

            # Possible Actions:
            # Roll 1 or 11 on any available banner
            
            for b_idx in range(len(banners)):
                # Check Banner Limits
                if b_idx in BANNER_LIMITS and usage[b_idx] >= BANNER_LIMITS[b_idx]:
                    continue

                banner = banners[b_idx]
                entry = banner.get(pos)
                
                if not entry:
                    continue
                    
                # Action: Roll 1
                # Check Resource Limits
                if MODE == "RESOURCE_LIMIT" and (res_tickets + 1 > MAX_TICKETS):
                    pass # Skip if exceeding tickets
                else: 
                    unit_got, next_p, note = get_next_pos_normal(pos, entry.get('unit'), banner, last_unit)
                    
                    if unit_got and next_p:
                        new_collected = collected
                        is_target = False
                        is_dupe = False
                        if unit_got in target_to_id:
                            bit = 1 << target_to_id[unit_got]
                            if not (new_collected & bit):
                                new_collected |= bit
                                is_target = True
                            else:
                                is_dupe = True
                        
                        new_usage = list(usage)
                        new_usage[b_idx] += 1
                        new_usage_tuple = tuple(new_usage)
                        
                        new_state_key = get_visited_key(next_p, new_collected, unit_got, new_usage_tuple)
                        
                        # Update resources
                        new_tickets = res_tickets + 1
                        new_catfood = res_catfood

                        current_visits = visited.get(new_state_key, [])
                        if not check_domination(new_tickets, new_catfood, current_visits):
                            visited[new_state_key] = update_visited(new_tickets, new_catfood, current_visits)
                            
                            msg = f"🎫 **Roll 1** on **Banner {b_idx+1}** ({pos} → {next_p}) | Got: {unit_got}"
                            if is_target:
                                msg += " **(🎯 TARGET!)**"
                            elif is_dupe:
                                msg += " **(🎯 DUPE!)**"
                            
                            acquired = [unit_got] if (is_target or is_dupe) else []
                            
                            # Linked List Path
                            new_path_node = ((msg, acquired, pos), path)
                            
                            # Priority: Prefer more collected (negative), then LESS CATFOOD, then LESS TICKETS.
                            # This implements "Slow Path First" (Ticket Priority) behavior.
                            collected_count = bin(new_collected).count('1')
                            priority = (-collected_count, new_catfood, new_tickets)
                            heapq.heappush(pq, (priority, steps + 1, next_p, new_collected, unit_got, new_usage_tuple, new_path_node, (new_tickets, new_catfood)))
                
                # Action: Roll 11 (Guaranteed)
                # Check Resource Limits
                guaranteed_unit = entry.get('guaranteed_unit')
                guaranteed_next = entry.get('guaranteed_next')
                
                if guaranteed_unit and guaranteed_next:
                    if MODE == "RESOURCE_LIMIT" and (res_catfood + 1500 > MAX_CATFOOD):
                        pass # Skip if exceeding catfood
                    else:
                        temp_collected = collected
                        temp_pos = pos
                        temp_last = last_unit
                        
                        units_found_in_10 = []
                        valid_simulation = True
                        targets_found_in_draw = []
                        
                        for _ in range(10):
                            u, np, _ = get_next_pos_normal(temp_pos, None, banner, temp_last)
                            if not u or not np:
                                valid_simulation = False
                                break
                            if u in target_to_id:
                                bit = 1 << target_to_id[u]
                                if not (temp_collected & bit):
                                    temp_collected |= bit
                                targets_found_in_draw.append(u)
                            units_found_in_10.append(u)
                            temp_pos = np
                            temp_last = u
                        
                        if valid_simulation:
                            if guaranteed_unit in target_to_id:
                                bit = 1 << target_to_id[guaranteed_unit]
                                if not (temp_collected & bit):
                                    temp_collected |= bit
                                targets_found_in_draw.append(guaranteed_unit)
                            
                            new_usage = list(usage)
                            new_usage[b_idx] += 1
                            new_usage_tuple = tuple(new_usage)
                            
                            new_state_key = get_visited_key(guaranteed_next, temp_collected, guaranteed_unit, new_usage_tuple)
                            
                            # Update resources
                            new_tickets = res_tickets
                            new_catfood = res_catfood + 1500

                            current_visits = visited.get(new_state_key, [])
                            if not check_domination(new_tickets, new_catfood, current_visits):
                                visited[new_state_key] = update_visited(new_tickets, new_catfood, current_visits)
                                
                                desc = f"🎰 **Guaranteed 11-Draw** on **Banner {b_idx+1}** at {pos}."
                                if targets_found_in_draw:
                                    desc += f" **(🎯 TARGETS: {', '.join(targets_found_in_draw)})**"
                                desc += f"\n    > Full Draw: {', '.join(units_found_in_10)} + **{guaranteed_unit}**"
                                
                                new_path_node = ((desc, targets_found_in_draw, pos), path)

                                collected_count = bin(temp_collected).count('1')
                                priority = (-collected_count, new_catfood, new_tickets)
                                heapq.heappush(pq, (priority, steps + 1, guaranteed_next, temp_collected, guaranteed_unit, new_usage_tuple, new_path_node, (new_tickets, new_catfood)))
    except KeyboardInterrupt:
        print("\nSearch interrupted by user. Saving found solutions...")

    print(f"Search finished. Found {len(solutions)} solutions.")
    
    if solutions:
        with open('all_solutions.md', 'w', encoding='utf-8') as f:
            f.write("# Seed Tracking Solutions\n\n")
            for i, (sol, final_pos) in enumerate(solutions):
                # Calculate cost
                tickets = 0
                catfood_draws = 0
                for action, _, _ in sol:
                    if "Roll 1" in action:
                        tickets += 1
                    elif "Guaranteed 11-Draw" in action:
                        catfood_draws += 1
                
                f.write(f"## Solution {i+1}\n")
                f.write(f"**Total Steps:** {len(sol)} | **Cost:** {tickets} Rare Tickets + {catfood_draws * 1500} Cat Food ({catfood_draws} Multi-Draws)\n\n")
                
                summary_data = []
                for step_idx, (action, acquired_targets, slot) in enumerate(sol):
                    f.write(f"- {action}\n")
                    for unit in acquired_targets:
                        summary_data.append((unit, step_idx + 1, slot))
                
                f.write(f"\n**Next Roll Position:** {final_pos}\n")

                # Calculate Missing and Duplicate Units
                acquired_units_list = [u for u, _, _ in summary_data]
                acquired_counter = collections.Counter(acquired_units_list)
                acquired_set = set(acquired_units_list)
                
                missing_units = sorted(list(TARGET_UBERS - acquired_set))
                duplicate_units = sorted([u for u, count in acquired_counter.items() if count > 1 and u in TARGET_UBERS])

                if missing_units:
                    f.write(f"\n**Missing Units ({len(missing_units)}):** {', '.join(missing_units)}\n")
                else:
                    f.write(f"\n**Missing Units:** None! All targets acquired.\n")

                if duplicate_units:
                     f.write(f"\n**Duplicate Targets:** {', '.join([f'{u} (x{acquired_counter[u]})' for u in duplicate_units])}\n")

                f.write("\n### Summary of Acquired Units\n")
                f.write("| Unit | Step | Slot |\n")
                f.write("|---|---|---|\n")
                for unit, step, slot in summary_data:
                    f.write(f"| {unit} | {step} | {slot} |\n")
                f.write("\n")
        print("Solutions saved to all_solutions.md")
    else:
        print("No solution found within limits.")

if __name__ == "__main__":
    solve()
